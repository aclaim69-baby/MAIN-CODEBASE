import { supabase } from './supabase';
import { safeGetItem, safeRemoveItem, safeSetItem } from './safeStorage';
import { useStorageMonitor } from './storageMonitor';
import type { Record, EvidenceImage } from '../store';

export const EVIDENCE_BUCKET = 'inspection-evidence';
export const MAX_EVIDENCE_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_EVIDENCE_WIDTH = 1280;
export const EVIDENCE_QUALITY = 0.8;

const QUEUE_KEY = 'dc_evidence_queue_v1';
const MAX_ATTEMPTS = 5;

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface QueuedEvidence {
  id: string;
  submissionId: string;
  equipmentNumber: string;
  checklistItemId: string | null;
  evidenceType: 'CHECKLIST_ITEM' | 'ADDITIONAL_COMMENT';
  image: EvidenceImage;
  uploadedBy?: string;
  queuedAt: string;
  attempts: number;
}

function extensionForType(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function cleanPathSegment(value: string): string {
  return (value || 'unknown')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; contentType: string } | null {
  if (!dataUrl.startsWith('data:')) return null;
  const [meta, b64] = dataUrl.split(',', 2);
  const match = /^data:(.+?);base64$/.exec(meta ?? '');
  if (!match || !b64) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { blob: new Blob([bytes], { type: match[1] }), contentType: match[1] };
  } catch {
    return null;
  }
}

function readQueue(): QueuedEvidence[] {
  try {
    const raw = safeGetItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) as QueuedEvidence[] : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedEvidence[]): void {
  const result = safeSetItem(QUEUE_KEY, JSON.stringify(items));
  if (!result.success) {
    useStorageMonitor.getState().handleWriteResult(result);
  }
}

function evidencePath(item: QueuedEvidence): string {
  // Use the submission date (queuedAt), NOT the current flush date.
  // Without this, evidence uploaded while offline lands in the wrong year/month
  // folder if the queue is flushed days after the original submission.
  const date = new Date(item.queuedAt);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const equipment = cleanPathSegment(item.equipmentNumber);
  const submission = cleanPathSegment(item.submissionId);
  const base = item.evidenceType === 'ADDITIONAL_COMMENT'
    ? 'comment-image'
    : cleanPathSegment(item.checklistItemId ?? 'item-image');
  const ext = extensionForType(item.image.mimeType);
  return `${year}/${month}/${equipment}/${submission}/${base}.${ext}`;
}

export async function compressEvidenceImage(file: File): Promise<EvidenceImage> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error('Supported image formats are JPG, JPEG, PNG, and WEBP.');
  }
  if (file.size > MAX_EVIDENCE_UPLOAD_BYTES) {
    throw new Error('Image must be 4 MB or smaller.');
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read this image.'));
      img.src = sourceUrl;
    });

    const scale = Math.min(1, MAX_EVIDENCE_WIDTH / Math.max(1, image.naturalWidth));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image compression is not supported on this device.');
    ctx.drawImage(image, 0, 0, width, height);

    const outputType = file.type === 'image/png' ? 'image/jpeg' : file.type;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Could not compress this image.')), outputType, EVIDENCE_QUALITY);
    });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not prepare this image.'));
      reader.readAsDataURL(blob);
    });

    return {
      id: crypto.randomUUID(),
      fileName: file.name,
      fileSize: blob.size,
      mimeType: outputType,
      dataUrl,
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function stripEvidenceDataUrls(record: Record): Record {
  return {
    ...record,
    checklistResponses: record.checklistResponses.map((r) => ({
      ...r,
      evidenceImage: r.evidenceImage ? { ...r.evidenceImage, dataUrl: undefined } : undefined,
    })),
    additionalEvidenceImage: record.additionalEvidenceImage
      ? { ...record.additionalEvidenceImage, dataUrl: undefined }
      : undefined,
  };
}

export function queueRecordEvidence(record: Record, uploadedBy?: string): void {
  const current = readQueue();
  const next = [...current];

  const pushOnce = (item: QueuedEvidence) => {
    const exists = next.some((q) => q.id === item.id);
    if (!exists) next.push(item);
  };

  record.checklistResponses.forEach((response) => {
    const image = response.evidenceImage;
    if (!image?.dataUrl) return;
    pushOnce({
      id: image.id,
      submissionId: record.submissionId,
      equipmentNumber: record.equipmentNumber,
      checklistItemId: response.itemId,
      evidenceType: 'CHECKLIST_ITEM',
      image,
      uploadedBy,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });
  });

  const commentImage = record.additionalEvidenceImage;
  if (commentImage?.dataUrl) {
    pushOnce({
      id: commentImage.id,
      submissionId: record.submissionId,
      equipmentNumber: record.equipmentNumber,
      checklistItemId: null,
      evidenceType: 'ADDITIONAL_COMMENT',
      image: commentImage,
      uploadedBy,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });
  }

  writeQueue(next);
}

export async function flushEvidenceQueue(): Promise<void> {
  const queue = readQueue();
  if (queue.length === 0) return;

  const remaining: QueuedEvidence[] = [];
  for (const item of queue) {
    if (item.attempts >= MAX_ATTEMPTS) continue;
    const parsed = item.image.dataUrl ? dataUrlToBlob(item.image.dataUrl) : null;
    if (!parsed) continue;

    try {
      const path = evidencePath(item);
      const { error: uploadError } = await supabase.storage
        .from(EVIDENCE_BUCKET)
        .upload(path, parsed.blob, {
          upsert: true,
          contentType: parsed.contentType,
          cacheControl: '31536000',
        });
      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase
        .from('inspection_evidence')
        .upsert({
          id: item.id,
          submission_id: item.submissionId,
          equipment_number: item.equipmentNumber,
          checklist_item_id: item.checklistItemId,
          evidence_type: item.evidenceType,
          image_url: path,
          file_name: item.image.fileName,
          file_size: parsed.blob.size,
          uploaded_by: item.uploadedBy ?? null,
          uploaded_at: new Date().toISOString(),
          sync_status: 'SYNCED',
        }, { onConflict: 'id' });
      if (rowError) throw rowError;
    } catch (err) {
      console.warn('[evidence] upload queued for retry:', err);
      remaining.push({ ...item, attempts: item.attempts + 1 });
    }
  }
  writeQueue(remaining);
}

export function startEvidenceQueueFlusher(): () => void {
  flushEvidenceQueue();
  const handleOnline = () => { void flushEvidenceQueue(); };
  window.addEventListener('online', handleOnline);
  return () => window.removeEventListener('online', handleOnline);
}

export function clearEvidenceQueue(): void {
  safeRemoveItem(QUEUE_KEY);
}

export async function createEvidenceSignedUrl(path: string): Promise<string | null> {
  if (!path || path.startsWith('data:') || path.startsWith('http')) return path;
  try {
    const { data, error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(path, 60 * 10);
    if (error) return null;
    return data.signedUrl ?? null;
  } catch {
    return null;
  }
}
