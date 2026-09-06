

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore, canViewRecords, canViewActivityLog, canViewFuelMonitoring } from './store';
import Header from './components/Header';
import LastUpdatedBar from './components/LastUpdatedBar';
import HomePage from './pages/HomePage';
import TechnicianFlow from './pages/TechnicianFlow';
import RecordsPage from './pages/RecordsPage';
import ActivityLogPage from './pages/ActivityLogPage';
import AdminPanel from './pages/AdminPanel';
import AnalysisPage, { type AnalyticsRestoreContext } from './pages/AnalysisPage';
import FuelMonitoringPage from './pages/FuelMonitoringPage';
import {
  startRealtimeSync,
  fetchRecordsPage,
  fetchRemoteLogs,
  fetchRecordsSince,
  fetchLogsSince,
  fetchRemoteTemplates,
  fetchRemoteDepartments,
  fetchRemoteSections,
  fetchRemoteEquipmentTypes,
  fetchRemoteAdmins,
  fetchRemoteSettings,
  migrateLocalToSupabase,
  SAFETY_NET_INTERVAL_MS,
  fetchRemoteFieldConfigs,
  getFieldConfigsVersion,
  fetchRemoteMappings,
  fetchRecordChecklist,
  isLogoUploadInProgress,
} from './lib/sync';

import { startQueueFlusher } from './lib/offlineQueue';
import { startEvidenceQueueFlusher } from './lib/evidence';
import { metrics } from './lib/metrics';
import StorageWarningBanner from './components/StorageWarningBanner';
import { useStorageMonitor } from './lib/storageMonitor';

import './lib/storageTest';

type Page = 'home' | 'new-check' | 'records' | 'log' | 'admin' | 'analysis' | 'fuel-monitoring';

/**
 * Reads deep-link params from the URL, e.g.:
 *   https://tictchecklist.vercel.app/?page=analysis&date=2026-07-29
 * Used by the WhatsApp/email fault report links to jump straight to a page
 * (and, for Analysis, a specific day) without any extra taps.
 */
function readDeepLinkParams(): { page: Page | null; date: string | null } {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawPage = params.get('page');
    const validPages: Page[] = ['home', 'new-check', 'records', 'log', 'admin', 'analysis', 'fuel-monitoring'];
    const page = validPages.includes(rawPage as Page) ? (rawPage as Page) : null;
    const rawDate = params.get('date');
    // Basic YYYY-MM-DD sanity check — ignore anything malformed rather than
    // passing junk down into the date pickers.
    const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
    return { page, date };
  } catch {
    return { page: null, date: null };
  }
}

export default function App() {
  const [deepLink] = useState(() => readDeepLinkParams());
  const [page, setPage] = useState<Page>(() => deepLink.page ?? 'home');
  const [passcodeSettingsReady, setPasscodeSettingsReady] = useState(false);
  const [passcodeUnlocked, setPasscodeUnlocked] = useState(() => {
    try {
      return sessionStorage.getItem('daily-checking-passcode-unlocked') === useStore.getState().settings.appPasscode;
    } catch {
      return false;
    }
  });
  // Ref ID to pre-filter when navigating from Analysis → Records
  const [pendingRecordRef, setPendingRecordRef] = useState<string | null>(null);
  // Opaque Analytics context captured at the moment of an Analysis → Records
  // ("View Checklist") navigation, round-tripped back to AnalysisPage when
  // the user hits "Back to Fault Analysis" on the record detail view so it
  // can restore filters/tab/drill-down state exactly (see AnalysisPage.tsx).
  const [pendingAnalyticsContext, setPendingAnalyticsContext] = useState<AnalyticsRestoreContext | null>(null);
  const [analyticsRestoreContext, setAnalyticsRestoreContext] = useState<AnalyticsRestoreContext | null>(null);
  const settings            = useStore((s) => s.settings);
  const isRealtimeConnected = useStore((s) => s.isRealtimeConnected);
  const lastSyncedAt        = useStore((s) => s.lastSyncedAt);
  const currentAdmin        = useStore((s) => s.currentAdmin);
  
  const canSeeRecords       = canViewRecords(currentAdmin, settings.recordsVisibility);
  const canSeeLog           = canViewActivityLog(currentAdmin, settings.activityLogVisibility ?? 'all');
  const canSeeFuelMonitoring = canViewFuelMonitoring(currentAdmin, settings.fuelMonitoringVisibility ?? 'admin_only');

  
  const checkStorageUsage = useStorageMonitor((s) => s.checkUsage);

  
  
  
  
  useEffect(() => {
    // Clean the deep-link query string (?page=...&date=...) out of the address
    // bar once it's been applied, so later in-app navigation / refreshes don't
    // keep re-reading a stale date.
    if (deepLink.page || deepLink.date) {
      try {
        window.history.replaceState({}, '', window.location.pathname);
      } catch {
        // no-op — non-fatal if history API is unavailable
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (page === 'records' && !canSeeRecords) {
      setPage('home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (page === 'log' && !canSeeLog) {
      setPage('home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (page === 'fuel-monitoring' && !canSeeFuelMonitoring) {
      setPage('home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [canSeeRecords, canSeeLog, canSeeFuelMonitoring, page]);

  
  
  const adminDataFetched = useRef(false);

  const footerText = settings.footerText?.trim() || 'Designed by workshop inventory';

  
  const realtimeStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remoteSettings = await fetchRemoteSettings();
      if (cancelled) return;
      if (remoteSettings) useStore.getState().mergeRemoteSettings(remoteSettings);
      setPasscodeSettingsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const unlockedWith = sessionStorage.getItem('daily-checking-passcode-unlocked');
      if (unlockedWith === settings.appPasscode) {
        setPasscodeUnlocked(true);
      } else if (passcodeUnlocked) {
        setPasscodeUnlocked(false);
      }
    } catch {
      if (passcodeUnlocked) setPasscodeUnlocked(false);
    }
  }, [settings.appPasscode, passcodeUnlocked]);

  
  

  
  
  
  
  
  
  const refreshSettings = useCallback(async (retryOnNullLogo = false) => {
    const { mergeRemoteSettings } = useStore.getState();
    const remoteSettings = await fetchRemoteSettings();
    if (!remoteSettings) return;

    
    
    
    
    const currentSettings = useStore.getState().settings;
    const logoJustCleared =
      (currentSettings.navLogoUrl  && !remoteSettings.navLogoUrl) ||
      (currentSettings.homeLogoUrl && !remoteSettings.homeLogoUrl);

    if (retryOnNullLogo && logoJustCleared) {
      console.debug('[App] settings: logo URL null after refresh — retrying in 2s...');
      setTimeout(async () => {
        const retried = await fetchRemoteSettings();
        if (retried) useStore.getState().mergeRemoteSettings(retried);
        console.debug('[App] settings: retry complete');
      }, 2000);
      
    }

    mergeRemoteSettings(remoteSettings);
    console.debug('[App] settings refreshed');
  }, []);

  const refreshAdminData = useCallback(async (force = false) => {
    
    refreshSettings();
    
    if (!force && adminDataFetched.current) return;
    adminDataFetched.current = true;
    const { mergeRemoteAdmins, mergeRemoteTemplates } = useStore.getState();
    const [remoteAdmins, remoteTemplates] = await Promise.all([
      fetchRemoteAdmins(),
      fetchRemoteTemplates(),
    ]);
    if (remoteAdmins && remoteAdmins.length > 0) mergeRemoteAdmins(remoteAdmins);
    mergeRemoteTemplates(remoteTemplates);
    console.debug('[App] admin data loaded');
  }, [refreshSettings]);

  
  const navigate = useCallback((p: Page) => {
    
    let resolvedPage: Page = p;
    if (p === 'records' && !canViewRecords(useStore.getState().currentAdmin, useStore.getState().settings.recordsVisibility)) {
      resolvedPage = 'home';
    }
    if (p === 'log' && !canViewActivityLog(useStore.getState().currentAdmin, useStore.getState().settings.activityLogVisibility ?? 'all')) {
      resolvedPage = 'home';
    }
    if (p === 'fuel-monitoring' && !canViewFuelMonitoring(useStore.getState().currentAdmin, useStore.getState().settings.fuelMonitoringVisibility ?? 'admin_only')) {
      resolvedPage = 'home';
    }
    setPage(resolvedPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Leaving Records for any reason other than the dedicated Back-to-Fault-
    // Analysis flow (which sets analyticsRestoreContext itself right before
    // calling navigate) drops the stale "came from Analytics" context so it
    // doesn't reappear on some later, unrelated visit to Records.
    if (resolvedPage !== 'records') setPendingAnalyticsContext(null);
    
    if (resolvedPage === 'admin' && !adminDataFetched.current) {
      refreshAdminData();
    }
  }, [refreshAdminData]);

  
  const refreshStructureData = useCallback(async () => {
    const { mergeRemoteDepartments, mergeRemoteSections, mergeRemoteEquipmentTypes, mergeRemoteMappings, mergeRemoteTemplates } = useStore.getState();
    const [remoteDepts, remoteSections, remoteEquipTypes, remoteMappings, remoteTemplates] = await Promise.all([
      fetchRemoteDepartments(),
      fetchRemoteSections(),
      fetchRemoteEquipmentTypes(),
      fetchRemoteMappings(),
      fetchRemoteTemplates(),  
    ]);
    if (remoteDepts      && remoteDepts.length > 0)      mergeRemoteDepartments(remoteDepts);
    if (remoteSections   && remoteSections.length > 0)   mergeRemoteSections(remoteSections);
    if (remoteEquipTypes && remoteEquipTypes.length > 0) mergeRemoteEquipmentTypes(remoteEquipTypes);
    if (remoteMappings)                                  mergeRemoteMappings(remoteMappings);
    mergeRemoteTemplates(remoteTemplates);
    console.debug('[App] structure data refreshed (incl. mappings + templates)');
  }, []);

  
  
  
  
  
  
  
  const refreshFieldConfigsIfStale = useCallback(async (force = false) => {
    const {
      fieldConfigsVersion,
      fieldConfigsCachedAt,
      mergeRemoteFieldConfigs,
      setFieldConfigsVersion,
      setFieldConfigsCachedAt,
    } = useStore.getState();
    try {
      
      const TTL_MS = 24 * 60 * 60 * 1000;
      const cachedAtMs = fieldConfigsCachedAt ? new Date(fieldConfigsCachedAt).getTime() : 0;
      const isStale = !cachedAtMs || (Date.now() - cachedAtMs) > TTL_MS;
      if (!force && !isStale) return;

      const remoteVersion = await getFieldConfigsVersion();
      if (!remoteVersion) return; 
      
      if (remoteVersion === fieldConfigsVersion) {
        console.debug('[App] field configs: no change detected (version match)');
        setFieldConfigsCachedAt(new Date().toISOString());
        return;
      }
      
      console.debug('[App] field configs: version changed, refetching...');
      const configs = await fetchRemoteFieldConfigs();
      if (configs && configs.length > 0) {
        mergeRemoteFieldConfigs(configs);
        setFieldConfigsVersion(remoteVersion);
        setFieldConfigsCachedAt(new Date().toISOString());
        console.debug('[App] field configs: updated', configs.length, 'configs');
      }
    } catch (err) {
      console.error('[App] refreshFieldConfigsIfStale error:', err);
    }
  }, []);

  
  const initialFetch = useCallback(async () => {
    const {
      mergeRemoteData,
      upsertRecords,
      setRecordsTotalCount,
      mergeRemoteDepartments,
      mergeRemoteSections,
      mergeRemoteEquipmentTypes,
      mergeRemoteSettings,
      mergeRemoteMappings,
      mergeRemoteTemplates,
      mergeRemoteFieldConfigs,
      setLastSyncedAt,
      setFieldConfigsVersion,
      fieldConfigsCachedAt,
      setFieldConfigsCachedAt,
    } = useStore.getState();

    try {
      
      
      
      
      
      
      const [
        remoteLogs,
        recordsPage1,
        remoteDepts,
        remoteSections,
        remoteEquipTypes,
        remoteSettings,
        remoteMappings,
        remoteTemplates,
        remoteAdminsOnBoot,
      ] = await Promise.all([
        fetchRemoteLogs(),
        fetchRecordsPage(1, 15),
        fetchRemoteDepartments(),
        fetchRemoteSections(),
        fetchRemoteEquipmentTypes(),
        fetchRemoteSettings(),
        fetchRemoteMappings(),
        fetchRemoteTemplates(),   
        fetchRemoteAdmins(),      
      ]);

      
      if (recordsPage1) {
        upsertRecords(recordsPage1.records);
        setRecordsTotalCount(recordsPage1.total);
      }
      
      mergeRemoteData(useStore.getState().records, remoteLogs);
      
      if (remoteDepts      && remoteDepts.length > 0)      mergeRemoteDepartments(remoteDepts);
      if (remoteSections   && remoteSections.length > 0)   mergeRemoteSections(remoteSections);
      if (remoteEquipTypes && remoteEquipTypes.length > 0) mergeRemoteEquipmentTypes(remoteEquipTypes);
      if (remoteSettings) mergeRemoteSettings(remoteSettings);
      if (remoteMappings) mergeRemoteMappings(remoteMappings);
      
      
      mergeRemoteTemplates(remoteTemplates);
      
      
      
      if (remoteAdminsOnBoot && remoteAdminsOnBoot.length > 0) {
        useStore.getState().mergeRemoteAdmins(remoteAdminsOnBoot);
        adminDataFetched.current = true; 
      }
      
      
      
      const TTL_MS = 24 * 60 * 60 * 1000;
      const cachedAtMs = fieldConfigsCachedAt ? new Date(fieldConfigsCachedAt).getTime() : 0;
      const isStale = !cachedAtMs || (Date.now() - cachedAtMs) > TTL_MS;
      if (isStale) {
        const remoteVersion = await getFieldConfigsVersion();
        const remoteFieldConfigs = await fetchRemoteFieldConfigs();
        if (remoteFieldConfigs && remoteFieldConfigs.length > 0) {
          mergeRemoteFieldConfigs(remoteFieldConfigs);
          if (remoteVersion) setFieldConfigsVersion(remoteVersion);
          setFieldConfigsCachedAt(new Date().toISOString());
        }
      }
      setLastSyncedAt(new Date().toISOString());

      console.debug('[App] initial fetch complete:',
        `${remoteLogs?.length ?? 'err'} logs`);
    } catch (err) {
      console.error('[App] initial fetch failed:', err);
    }
  }, []);

  
  
  
  
  
  
  const safetyNetPoll = useCallback(async () => {
    
    if (useStore.getState().isRealtimeConnected) {
      console.debug('[App] safety-net skipped — realtime active');
      return;
    }
    const { lastSyncedAt: lastSync, setLastSyncedAt } = useStore.getState();
    metrics.safetyNetPoll();

    try {
      if (lastSync) {
        const [newRecords, newLogs] = await Promise.all([
          fetchRecordsSince(lastSync),
          fetchLogsSince(lastSync),
        ]);

        if (newRecords !== null && newLogs !== null) {
          if (newRecords.length > 0 || newLogs.length > 0) {
            const store = useStore.getState();
            const existingIds = new Set(store.records.map((r) => r.id));
            const trulyNew = newRecords.filter((r) => !existingIds.has(r.id));
            if (trulyNew.length > 0) {
              
              
              
              
              
              trulyNew.forEach((r) => store._realtimeInsertRecord(r));
              trulyNew.forEach(async (r) => {
                // fetchRecordChecklist returns an object — destructure correctly.
                const result = await fetchRecordChecklist(r.id);
                if (result && result.checklist.length > 0) {
                  useStore.getState().setRecordChecklist(
                    r.id,
                    result.checklist,
                    result.additionalComment,
                    result.additionalEvidenceImage,
                  );
                }
              });
            }
            const existingLogIds = new Set(store.activityLogs.map((l) => l.id));
            const newLogEntries = newLogs.filter((l) => !existingLogIds.has(l.id));
            if (newLogEntries.length > 0) {
              newLogEntries.forEach((l) => store._realtimeInsertLog(l));
            }
            console.debug('[App] safety-net delta: added', trulyNew.length, 'records,', newLogEntries.length, 'logs');
          }
          setLastSyncedAt(new Date().toISOString());
        }
      } else {
        const [page1, remoteLogs] = await Promise.all([
          fetchRecordsPage(1, 15),
          fetchRemoteLogs(),
        ]);
        if (page1) {
          useStore.getState().upsertRecords(page1.records);
          useStore.getState().setRecordsTotalCount(page1.total);
        }
        useStore.getState().mergeRemoteData(useStore.getState().records, remoteLogs);
        setLastSyncedAt(new Date().toISOString());
      }
      
      
      refreshFieldConfigsIfStale();
    } catch (err) {
      console.error('[App] safety-net poll failed:', err);
    }
  }, [refreshFieldConfigsIfStale]);

  
  const handleBroadcastRefresh = useCallback((table: 'records' | 'logs' | 'all') => {
    console.debug('[App] 📡 broadcast refresh — table:', table);

    
    
    
    
    const realtimeOk = useStore.getState().isRealtimeConnected;

    if (table === 'records') {
      if (realtimeOk) {
        
        
        
        const lastSync = useStore.getState().lastSyncedAt;
        if (lastSync) {
          fetchLogsSince(lastSync).then((rows) => {
            if (!rows) return;
            const store = useStore.getState();
            rows.filter((l) => !store.activityLogs.find((x) => x.id === l.id))
                .forEach((l) => store._realtimeInsertLog(l));
          });
        }
        console.debug('[App] 📡 broadcast records — realtime active, fetching logs only');
        return;
      }
      const lastSync = useStore.getState().lastSyncedAt;
      if (lastSync) {
        
        Promise.all([
          fetchRecordsSince(lastSync),
          fetchLogsSince(lastSync),
        ]).then(async ([rows, logRows]) => {
          const store = useStore.getState();
          if (rows) {
            const newRows = rows.filter((r) => !store.records.find((x) => x.id === r.id));
            newRows.forEach((r) => store._realtimeInsertRecord(r));
            newRows.forEach(async (r) => {
              // fetchRecordChecklist returns an object — destructure correctly.
              const result = await fetchRecordChecklist(r.id);
              if (result && result.checklist.length > 0) {
                useStore.getState().setRecordChecklist(
                  r.id,
                  result.checklist,
                  result.additionalComment,
                  result.additionalEvidenceImage,
                );
              }
            });
          }
          if (logRows) {
            logRows.filter((l) => !store.activityLogs.find((x) => x.id === l.id))
                   .forEach((l) => store._realtimeInsertLog(l));
          }
        });
      }
    } else if (table === 'logs') {
      if (realtimeOk) {
        console.debug('[App] 📡 broadcast logs skipped — realtime active');
        return;
      }
      const lastSync = useStore.getState().lastSyncedAt;
      if (lastSync) {
        fetchLogsSince(lastSync).then((rows) => {
          if (!rows) return;
          const store = useStore.getState();
          rows.filter((l) => !store.activityLogs.find((x) => x.id === l.id))
              .forEach((l) => store._realtimeInsertLog(l));
        });
      }
    } else {
      
      
      Promise.all([
        refreshAdminData(),
        refreshStructureData(),
        refreshFieldConfigsIfStale(true),
      ]);
    }
  }, [refreshAdminData, refreshStructureData, refreshFieldConfigsIfStale]);

  useEffect(() => {
    if (!passcodeUnlocked && settings.passcodeEnabled) return;
    if (realtimeStarted.current) return;
    realtimeStarted.current = true;

    const {
      setRealtimeConnected,
      _realtimeInsertRecord,
      _realtimeDeleteRecord,
      _realtimeUpdateRecord,
      _realtimeInsertLog,
      _realtimeDeleteLog,
    } = useStore.getState();

    
    
    

    
    
    
    
    checkStorageUsage();
    const storageCheckInterval = setInterval(checkStorageUsage, 60_000);

    
    const stopRealtime = startRealtimeSync({
      onRecordInsert: async (record) => {
        _realtimeInsertRecord(record);
        // fetchRecordChecklist returns { checklist, additionalComment, additionalEvidenceImage }
        // — NOT the array itself. Always destructure the result object.
        const incomingHasChecklist =
          Array.isArray(record.checklistResponses) && record.checklistResponses.length > 0;
        if (!incomingHasChecklist) {
          const result = await fetchRecordChecklist(record.id);
          if (result && result.checklist.length > 0) {
            useStore.getState().setRecordChecklist(
              record.id,
              result.checklist,
              result.additionalComment,
              result.additionalEvidenceImage,
            );
          }
        }
      },
      onRecordDelete:  (id)     => _realtimeDeleteRecord(id),
      onRecordUpdate:  (record) => _realtimeUpdateRecord(record),
      onLogInsert:     (log)    => _realtimeInsertLog(log),
      onLogDelete:     (id)     => _realtimeDeleteLog(id),
      onStatusChange:  (conn)   => setRealtimeConnected(conn),
      onRefreshNeeded: handleBroadcastRefresh,
      onMappingInsert: (mapping) => {
        useStore.getState()._realtimeMappingInsert(mapping);
        fetchRemoteMappings().then((all) => {
          if (all) useStore.getState().mergeRemoteMappings(all);
        });
      },
      onMappingDelete: (id) => {
        useStore.getState()._realtimeMappingDelete(id);
        fetchRemoteMappings().then((all) => {
          if (all) useStore.getState().mergeRemoteMappings(all);
        });
      },
      onSettingsChange: () => {
        
        
        
        
        
        
        
        
        
        if (isLogoUploadInProgress()) {
          console.debug('[App] settings change suppressed on uploader — logo upload in progress');
          return;
        }
        
        
        refreshSettings(true);
      },
    });

    
    
    const stopQueueFlusher = startQueueFlusher();
    const stopEvidenceQueueFlusher = startEvidenceQueueFlusher();

    
    const { records: localRecords, activityLogs: localLogs } = useStore.getState();
    migrateLocalToSupabase(localRecords, localLogs);

    
    (async () => {
      
      
      
      const FIVE_MIN_MS = 5 * 60 * 1000;
      const last = useStore.getState().lastSyncedAt;
      const lastMs = last ? new Date(last).getTime() : 0;
      const recentlySynced = !!lastMs && (Date.now() - lastMs) < FIVE_MIN_MS;

      if (!recentlySynced) {
        initialFetch();
        return;
      }

      
      const start = Date.now();
      while (Date.now() - start < 3000) {
        if (useStore.getState().isRealtimeConnected) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      if (useStore.getState().isRealtimeConnected) {
        console.debug('[App] ✅ skip initial fetch (recently synced + realtime active)');
        return;
      }

      
      initialFetch();
    })();

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    

    const safetyNetRef = { timer: null as ReturnType<typeof setInterval> | null };

    function startSafetyNet() {
      
      if (safetyNetRef.timer !== null) {
        clearInterval(safetyNetRef.timer);
      }
      safetyNetRef.timer = setInterval(safetyNetPoll, SAFETY_NET_INTERVAL_MS);
    }

    function stopSafetyNet() {
      if (safetyNetRef.timer !== null) {
        clearInterval(safetyNetRef.timer);
        safetyNetRef.timer = null;
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        
        stopSafetyNet();
        console.debug('[App] 👁️  tab hidden — safety-net paused');
      } else {
        
        
        
        
        
        
        console.debug('[App] 👁️  tab visible — waiting for Realtime before catch-up poll');
        const REALTIME_GRACE_MS = 2_000;
        const visibleAt = Date.now();
        const waitForRealtime = () => {
          if (useStore.getState().isRealtimeConnected) {
            
            
            console.debug('[App] 👁️  Realtime active — skipping catch-up poll');
          } else if (Date.now() - visibleAt < REALTIME_GRACE_MS) {
            
            setTimeout(waitForRealtime, 100);
            return;
          } else {
            
            console.debug('[App] 👁️  Realtime not connected — running catch-up poll');
            safetyNetPoll();
          }
          startSafetyNet(); 
        };
        waitForRealtime();
      }
    }

    
    
    
    
    if (!document.hidden) {
      setTimeout(startSafetyNet, 10_000);
    } else {
      console.debug('[App] 👁️  app loaded in background tab — safety-net deferred until visible');
    }

    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    
    const metricsInterval = setInterval(() => metrics.logSummary(), 5 * 60 * 1000);

    return () => {
      stopRealtime();
      stopQueueFlusher();
      stopEvidenceQueueFlusher();
      stopSafetyNet();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(metricsInterval);
      clearInterval(storageCheckInterval);
      realtimeStarted.current = false;
      console.debug('[App] all channels and listeners cleaned up');
    };
  
  }, [passcodeUnlocked, settings.passcodeEnabled, handleBroadcastRefresh, initialFetch, safetyNetPoll, refreshFieldConfigsIfStale, checkStorageUsage]);

  if (settings.passcodeEnabled && !passcodeUnlocked) {
    return (
      <PasscodeGate
        settingsReady={passcodeSettingsReady}
        settings={settings}
        onUnlock={() => {
          try {
            sessionStorage.setItem('daily-checking-passcode-unlocked', settings.appPasscode);
          } catch {
            
          }
          setPasscodeUnlocked(true);
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header
        currentPage={page}
        onNavigate={(p) => navigate(p as Page)}
        isRealtimeConnected={isRealtimeConnected}
        lastSyncedAt={lastSyncedAt}
      />

      <LastUpdatedBar />

      {}
      <StorageWarningBanner />

      <main style={{ flex: 1 }}>
        {page === 'home'      && <HomePage onNavigate={(p) => navigate(p as Page)} />}
        {page === 'new-check' && <TechnicianFlow onNavigate={(p) => navigate(p as Page)} />}
        {page === 'records'   && canSeeRecords && (
          <RecordsPage
            initialRefFilter={pendingRecordRef ?? undefined}
            onRefFilterConsumed={() => setPendingRecordRef(null)}
            analyticsContext={pendingAnalyticsContext ?? undefined}
            onBackToFaultAnalysis={pendingAnalyticsContext ? () => {
              setAnalyticsRestoreContext(pendingAnalyticsContext);
              navigate('analysis');
            } : undefined}
          />
        )}
        {page === 'records'   && !canSeeRecords && null }
        {page === 'log'       && <ActivityLogPage />}
        {page === 'fuel-monitoring' && canSeeFuelMonitoring && <FuelMonitoringPage />}
        {page === 'admin'     && <AdminPanel />}
        {page === 'analysis'  && (
          <AnalysisPage
            initialDate={deepLink.date ?? undefined}
            restoreContext={analyticsRestoreContext}
            onRestoreContextConsumed={() => setAnalyticsRestoreContext(null)}
            onNavigateToRecord={(refId, context) => {
              setPendingRecordRef(refId);
              setPendingAnalyticsContext(context);
              navigate('records');
            }}
          />
        )}
      </main>

      <footer className="app-footer">{footerText}</footer>
    </div>
  );
}

function PasscodeGate({
  settingsReady,
  settings,
  onUnlock,
}: {
  settingsReady: boolean;
  settings: ReturnType<typeof useStore.getState>['settings'];
  onUnlock: () => void;
}) {
  const [digits, setDigits] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const logoUrl = settings.passcodeLogoUrl || settings.homeLogoUrl || settings.navLogoUrl;

  useEffect(() => {
    inputRef.current?.focus();
  }, [settingsReady]);

  function submit(nextDigits = digits) {
    if (!settingsReady) return;
    if (nextDigits === settings.appPasscode) {
      setError('');
      onUnlock();
      return;
    }
    setError('Incorrect passcode. Please try again.');
    setDigits('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleChange(value: string) {
    const next = value.replace(/\D/g, '').slice(0, 4);
    setDigits(next);
    setError('');
    if (next.length === 4) submit(next);
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'linear-gradient(135deg, #F7F2E8 0%, #EEF6F0 52%, #F8FAFC 100%)',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 390,
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid rgba(26,26,24,0.08)',
          borderRadius: 14,
          boxShadow: '0 24px 80px rgba(26,26,24,0.12)',
          padding: '28px 24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            margin: '0 auto 18px',
            borderRadius: 18,
            background: logoUrl ? '#fff' : '#1A1A18',
            border: '1px solid rgba(26,26,24,0.08)',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
          }}
        >
          {logoUrl ? (
            <img src={logoUrl} alt="App logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 10 }} />
          ) : (
            <span style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>DC</span>
          )}
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 6 }}>Enter Passcode</h1>
        <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 22 }}>
          Enter the 4 digit app passcode to continue.
        </p>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className="form-input"
          value={digits}
          disabled={!settingsReady}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="••••"
          maxLength={4}
          aria-label="4 digit passcode"
          style={{
            textAlign: 'center',
            fontSize: 28,
            letterSpacing: 10,
            height: 58,
            marginBottom: 12,
          }}
        />

        {error && (
          <div style={{ color: '#B91C1C', fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button
          type="button"
          className="btn-primary"
          disabled={!settingsReady || digits.length !== 4}
          onClick={() => submit()}
          style={{ width: '100%' }}
        >
          {settingsReady ? 'Unlock App' : 'Loading Security Settings...'}
        </button>
      </section>
    </main>
  );
}
