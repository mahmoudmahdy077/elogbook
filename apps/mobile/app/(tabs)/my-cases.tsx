import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { getDatabase } from '../../lib/db/database';
import { CaseEntry } from '../../lib/db/models/CaseEntry';
import { getAllCasesForResident, getConflictedCases } from '../../lib/db/storage';
import { syncService } from '../../lib/sync';
import { supabase } from '../../lib/supabase';
import StatusBadge from '../../components/StatusBadge';
import type { CaseStatus } from '@elogbook/shared';

interface CaseData {
  id: string;
  patient_mrn: string | null;
  patient_dob: string | null;
  case_date: string;
  status: CaseStatus;
  template_name: string;
  template_specialty: string;
  is_deidentified: boolean;
  local_sync_status: string;
}

type FilterType = 'all' | 'draft' | 'pending' | 'approved' | 'rejected' | 'conflict';

export default function MyCasesScreen() {
  const [cases, setCases] = useState<CaseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [conflictDrafts, setConflictDrafts] = useState<{ entryId: string; residentId: string }[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadCases = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!profile) { setLoading(false); return; }

    const db = getDatabase();
    const localEntries = await getAllCasesForResident(profile.id);
    const localTemplates = await db.get<import('../../lib/db/models/CaseTemplate').CaseTemplate>('case_templates').query().fetch();
    const templateMap = new Map(localTemplates.map((t) => [t.id, t]));

    const conflicts = await getConflictedCases();

    const mapped: CaseData[] = localEntries.map((entry: CaseEntry) => {
      const tmpl = templateMap.get(entry.templateId);
      return {
        id: entry.id,
        patient_mrn: entry.patientMrn,
        patient_dob: entry.patientDob,
        case_date: entry.caseDate,
        status: (entry.status ?? 'draft') as CaseStatus,
        template_name: tmpl?.name ?? '',
        template_specialty: tmpl?.specialty ?? '',
        is_deidentified: entry.isDeidentified ?? true,
        local_sync_status: entry.localSyncStatus,
      };
    });

    setCases(mapped);

    if (conflicts.length > 0) {
      setConflictDrafts(conflicts.map((c) => ({ entryId: c.id, residentId: c.residentId })));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadCases();
    const unsub = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false);
    });
    return () => unsub();
  }, [loadCases]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncService.initSync();
    await loadCases();
    setRefreshing(false);
  }, [loadCases]);

  const filteredCases = filter === 'all'
    ? cases
    : filter === 'conflict'
      ? cases.filter(c => conflictDrafts.some(d => d.entryId === c.id))
      : cases.filter(c => c.status === filter);

  const FILTER_CHIPS: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Drafts' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'conflict', label: 'Conflicts' },
  ];

  const handleCaseTap = (c: CaseData) => {
    if (c.status === 'rejected') {
      router.push({ pathname: '/log-case', params: { editCaseId: c.id } });
    }
  };

  const SYNC_STATUS_LABELS: Record<string, string> = {
    draft: 'Offline',
    modified: 'Modified',
    conflict: 'Conflict',
    synced: '',
  };

  if (loading) {
    return (
      <View className="flex-1 bg-backdrop items-center justify-center">
        <ActivityIndicator color="#0D9488" size="large" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-backdrop">
      {isOffline && (
        <View className="bg-red-500/10 border-b border-red-500/30 px-4 py-2">
          <Text className="text-red-400 text-sm text-center font-semibold">Offline — showing cached data</Text>
        </View>
      )}

      {conflictDrafts.length > 0 && (
        <View className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-3 flex-row items-center gap-2">
          <Text className="text-amber-400 text-sm flex-1">
            Case updated by supervisor — offline edits saved as new draft
          </Text>
          <TouchableOpacity onPress={() => setFilter('conflict')}>
            <Text className="text-amber-400 font-semibold text-sm">View</Text>
          </TouchableOpacity>
        </View>
      )}

      <View className="px-4 pt-4 pb-2">
        <Text className="text-white text-2xl font-bold mb-3">My Cases</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2 mb-2">
          {FILTER_CHIPS.map((chip) => (
            <TouchableOpacity
              key={chip.key}
              className={`rounded-full px-4 py-1.5 mr-2 border ${
                filter === chip.key
                  ? 'bg-teal-600 border-teal-500'
                  : 'bg-slate-900 border-indigo-500/15'
              }`}
              onPress={() => setFilter(chip.key)}
            >
              <Text className={`text-xs font-semibold ${filter === chip.key ? 'text-white' : 'text-slate-400'}`}>
                {chip.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filteredCases}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#0D9488" />
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        ListEmptyComponent={
          <View className="bg-slate-900 rounded-xl p-6 border border-indigo-500/15 items-center">
            <Text className="text-slate-400">No cases found.</Text>
          </View>
        }
        renderItem={({ item: c }) => (
          <TouchableOpacity
            className="bg-slate-900 rounded-xl p-4 border border-indigo-500/15 mb-3"
            onPress={() => handleCaseTap(c)}
          >
            <View className="flex-row justify-between items-start">
              <View className="flex-1 mr-3">
                <Text className="text-white font-semibold">
                  {c.template_specialty} - {c.template_name}
                </Text>
                <Text className="text-slate-400 text-xs mt-1 font-mono">
                  {c.is_deidentified ? `Age: — Hash: ${c.patient_mrn?.slice(0, 12) ?? '—'}` : `MRN: ${c.patient_mrn}`}
                </Text>
                <Text className="text-slate-500 text-xs mt-1" style={{ fontFamily: 'Geist Mono' }}>
                  {c.case_date}
                </Text>
              </View>
              <View className="flex-col items-end gap-1">
                <StatusBadge status={c.status} />
                {SYNC_STATUS_LABELS[c.local_sync_status] ? (
                  <Text className="text-xs text-slate-500">{SYNC_STATUS_LABELS[c.local_sync_status]}</Text>
                ) : null}
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}