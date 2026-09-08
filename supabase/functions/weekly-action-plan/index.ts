import { createClient } from 'npm:@supabase/supabase-js@2';

type ChecklistItem = {
  check?: unknown;
  label?: unknown;
  status?: unknown;
  comment?: unknown;
  action_plan?: unknown;
  actionPlan?: unknown;
};

type RecordRow = {
  equipment_type: string | null;
  equipment_number: string | null;
  date: string | null;
  technician: string | null;
  section: string | null;
  ref_id: string | null;
  checklist: unknown;
  requires_urgent_attention: boolean | null;
  urgent_attention_reason: string | null;
};

type ActionPlanTask = {
  bucket: 'ROLLING STOCK Team' | 'RTG Team' | 'MHC Team' | 'Urgent Attention';
  title: string;
  priority: 'Medium' | 'Urgent';
  start_date: string;
  notes: string;
};

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8',
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseChecklist(value: unknown): ChecklistItem[] {
  if (Array.isArray(value)) return value as ChecklistItem[];
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as ChecklistItem[] : [];
  } catch {
    return [];
  }
}

function bucketForSection(section: string | null): ActionPlanTask['bucket'] | null {
  switch (text(section).toUpperCase()) {
    case 'ROLLING STOCK CHECKLIST':
      return 'ROLLING STOCK Team';
    case 'RTG CHECKLIST':
      return 'RTG Team';
    case 'MHC CHECKLIST':
      return 'MHC Team';
    default:
      // Bromma and any non-operational/unknown sections are intentionally excluded.
      return null;
  }
}

function formatLagosDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function subtractDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day - days));
  return result.toISOString().slice(0, 10);
}

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: 'Use GET or POST.' }, 405);
  }

  try {
    const requestUrl = new URL(request.url);
    let payload: Record<string, unknown> = {};
    if (request.method === 'POST') {
      try {
        payload = await request.json() as Record<string, unknown>;
      } catch {
        return json({ error: 'POST body must be valid JSON.' }, 400);
      }
    }

    const requestedStart = text(payload.start_date ?? requestUrl.searchParams.get('start_date') ?? undefined);
    const requestedEnd = text(payload.end_date ?? requestUrl.searchParams.get('end_date') ?? undefined);
    const today = formatLagosDate(new Date());
    const startDate = requestedStart || subtractDays(today, 6);
    const endDate = requestedEnd || today;

    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      return json({ error: 'start_date and end_date must be YYYY-MM-DD, with start_date on or before end_date.' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data, error } = await supabase
      .from('records')
      .select('equipment_type, equipment_number, date, technician, section, ref_id, checklist, requires_urgent_attention, urgent_attention_reason')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (error) {
      console.error('Unable to fetch weekly action-plan records:', error);
      return json({ error: 'Unable to fetch records.' }, 500);
    }

    const tasks: ActionPlanTask[] = [];
    for (const record of (data ?? []) as RecordRow[]) {
      const bucket = bucketForSection(record.section);
      if (!bucket) continue;

      const equipment = `${text(record.equipment_type)} ${text(record.equipment_number)}`.trim();
      const refId = text(record.ref_id);
      const recordDate = text(record.date);

      for (const item of parseChecklist(record.checklist)) {
        if (text(item.status).toUpperCase() !== 'NOT OK') continue;

        const check = text(item.check) || text(item.label);
        const comment = text(item.comment);
        const actionPlan = text(item.action_plan) || text(item.actionPlan);
        const title = check
          ? `${equipment}: ${check} — ${comment}`
          : `${equipment}: ${comment}`;
        tasks.push({
          bucket,
          title,
          priority: 'Medium',
          start_date: recordDate,
          notes: `Check: ${check}\nAction plan: ${actionPlan}\nTechnician: ${text(record.technician)}\nRef: ${refId}`,
        });
      }

      if (record.requires_urgent_attention === true) {
        tasks.push({
          bucket: 'Urgent Attention',
          title: `URGENT — ${equipment}: see ${refId}`,
          priority: 'Urgent',
          start_date: recordDate,
          notes: `${text(record.urgent_attention_reason)}\n\nRef: ${refId}\nDate: ${recordDate}`,
        });
      }
    }

    return json(tasks);
  } catch (error) {
    console.error('Unexpected weekly-action-plan error:', error);
    return json({ error: 'Unexpected server error.' }, 500);
  }
});
