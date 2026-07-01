import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import { getDatabase } from '../../lib/db/database';
import type { CaseEntry } from '../../lib/db/models/CaseEntry';
import { upsertCaseEntry } from '../../lib/db/storage';
import { useHaptics } from '../../lib/haptics';
import { NativeGlassPanel as GlassPanel, NativeStatusBadge as StatusBadge } from '@elogbook/shared/components/native';
import { clinicalTokens } from '@elogbook/shared';
import type { CaseStatus, UserRole } from '@elogbook/shared';

interface CaseDetail {
  id: string;
  resident_name: string;
  specialty: string;
  template_name: string;
  case_date: string;
  status: CaseStatus;
  is_deidentified: boolean;
  patient_mrn: string | null;
  patient_dob: string | null;
  patient_age_years: number | null;
  patient_hash: string | null;
  field_values: Record<string, unknown>;
  rejection_comment: string | null;
  created_at: string;
  updated_at: string;
}

export default function CaseDetailScreen() {
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [processing, setProcessing] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const haptics = useHaptics();

  const loadCase = useCallback(async () => {
    if (!caseId) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role, tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) {
      setLoading(false);
      return;
    }

    setRole(profile.role as UserRole);

    const db = getDatabase();
    try {
      const localEntry = await db.get<CaseEntry>('case_entries').find(caseId);
      if (localEntry) {
        setCaseDetail({
          id: localEntry.id,
          resident_name: '',
          specialty: '',
          template_name: '',
          case_date: localEntry.caseDate ?? '',
          status: (localEntry.status ?? 'draft') as CaseStatus,
          is_deidentified: localEntry.isDeidentified ?? true,
          patient_mrn: localEntry.patientMrn ?? null,
          patient_dob: localEntry.patientDob ?? null,
          patient_age_years: localEntry.patientAgeYears ?? null,
          patient_hash: localEntry.patientHash ?? null,
          field_values: localEntry.fieldValues ?? {},
          rejection_comment: null,
          created_at: localEntry.createdAt?.toISOString() ?? '',
          updated_at: localEntry.updatedAt?.toISOString() ?? '',
        });
        setLoading(false);
      }
    } catch {
      // Not in local DB — proceed to network fetch
    }

    if (!isOffline) {
      const { data: entry } = await supabase
        .from('case_entries')
        .select(
          'id, case_date, status, is_deidentified, patient_mrn, patient_dob, patient_age_years, patient_hash, field_values, created_at, updated_at, template_id, resident_id, case_templates(name, specialty), profiles(full_name), approval_requests(comment, status)'
        )
        .eq('id', caseId)
        .single();

      if (entry) {
        const rejectionRequest = (entry as any).approval_requests?.find(
          (r: any) => r.status === 'rejected'
        );
        setCaseDetail({
          id: entry.id,
          resident_name: (entry as any).profiles?.full_name ?? 'Unknown',
          specialty: (entry as any).case_templates?.specialty ?? '',
          template_name: (entry as any).case_templates?.name ?? '',
          case_date: entry.case_date,
          status: entry.status as CaseStatus,
          is_deidentified: entry.is_deidentified,
          patient_mrn: entry.patient_mrn,
          patient_dob: entry.patient_dob,
          patient_age_years: entry.patient_age_years,
          patient_hash: entry.patient_hash,
          field_values: entry.field_values ?? {},
          rejection_comment: rejectionRequest?.comment ?? null,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
        });
        await upsertCaseEntry(entry as Record<string, unknown>);
      }
    }

    setLoading(false);
  }, [caseId, isOffline]);

  useEffect(() => {
    loadCase();

    const netUnsub = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected !== true);
    });

    return () => {
      netUnsub();
    };
  }, [loadCase]);

  const handleApprovalAction = useCallback(
    async (action: 'approve' | 'reject', comment?: string) => {
      if (!caseId || !caseDetail) return;
      setProcessing(true);
      haptics.approvalAction();

      try {
        const { error } = await supabase.rpc(
          action === 'approve' ? 'approve_case' : 'reject_case',
          {
            p_entry_id: caseId,
            ...(action === 'reject' ? { p_comment: comment ?? '' } : {}),
          }
        );

        if (error) throw error;

        haptics.submitSuccess();
        await loadCase();
      } catch {
        haptics.submitError();
        Alert.alert('Error', `Failed to ${action} case. Please try again.`);
      } finally {
        setProcessing(false);
      }
    },
    [caseId, caseDetail, haptics, loadCase]
  );

  const confirmAction = useCallback(
    (action: 'approve' | 'reject') => {
      if (action === 'reject') {
        setRejectComment('');
        setRejectModalOpen(true);
        return;
      }
      const title = 'Approve Case?';
      Alert.alert(title, 'This case will be approved.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: () => handleApprovalAction(action),
        },
      ]);
    },
    [handleApprovalAction]
  );

  const submitReject = useCallback(() => {
    const trimmed = rejectComment.trim();
    if (!trimmed) {
      Alert.alert('Reason required', 'Please provide a reason for rejecting this case.');
      return;
    }
    setRejectModalOpen(false);
    handleApprovalAction('reject', trimmed);
  }, [rejectComment, handleApprovalAction]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  if (!caseDetail) {
    return (
      <View className="flex-1 items-center justify-center px-4" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <Text className="text-slate-400">Case not found.</Text>
        <TouchableOpacity
          className="mt-4 bg-teal-600 px-6 py-2 rounded-lg"
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text className="text-white">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const canApprove = role === 'supervisor' || role === 'director' || role === 'admin';
  const canEdit = caseDetail.status === 'draft' || caseDetail.status === 'rejected';

  return (
    <ScrollView className="flex-1 px-4 pt-4" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }} contentContainerStyle={{ paddingBottom: 40 }}>
      {isOffline && (
        <View className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
          <Text className="text-red-400 text-sm text-center" style={{ fontFamily: clinicalTokens.fonts.body }}>Offline — actions require a connection</Text>
        </View>
      )}

      <View className="flex-row justify-between items-start mb-4">
        <View className="flex-1 mr-3">
          <Text className="text-white text-xl" style={{ fontFamily: clinicalTokens.fonts.heading }}>{caseDetail.specialty}</Text>
          <Text className="text-indigo-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.mono }}>
            {caseDetail.template_name}
          </Text>
        </View>
        <StatusBadge status={caseDetail.status} />
      </View>

      <GlassPanel style={{ marginBottom: 12 }}>
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>Patient Info</Text>
        {caseDetail.is_deidentified ? (
          <View>
            <Text className="text-slate-300 text-sm" style={{ fontFamily: 'Geist Mono' }}>
              Age: {caseDetail.patient_age_years ?? '—'}
            </Text>
            <Text className="text-slate-500 text-xs mt-1" style={{ fontFamily: 'Geist Mono' }}>
              Hash: {caseDetail.patient_hash?.slice(0, 12) ?? '—'}
            </Text>
          </View>
        ) : (
          <View>
            <Text className="text-slate-300 text-sm" style={{ fontFamily: 'Geist Mono' }}>
              MRN: {caseDetail.patient_mrn ?? '—'}
            </Text>
            <Text className="text-slate-500 text-xs mt-1" style={{ fontFamily: 'Geist Mono' }}>
              DOB: {caseDetail.patient_dob ?? '—'}
            </Text>
          </View>
        )}
      </GlassPanel>

      <GlassPanel style={{ marginBottom: 12 }}>
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>Case Data</Text>
        <Text className="text-slate-300 text-sm mb-1" style={{ fontFamily: clinicalTokens.fonts.mono }}>
          Date: {caseDetail.case_date}
        </Text>
        <Text className="text-slate-300 text-sm mb-1" style={{ fontFamily: clinicalTokens.fonts.mono }}>
          Resident: {caseDetail.resident_name}
        </Text>
        <Text className="text-slate-500 text-xs mt-2" style={{ fontFamily: clinicalTokens.fonts.mono }}>
          Created: {new Date(caseDetail.created_at).toLocaleString()}
        </Text>
        <Text className="text-slate-500 text-xs" style={{ fontFamily: clinicalTokens.fonts.mono }}>
          Updated: {new Date(caseDetail.updated_at).toLocaleString()}
        </Text>
      </GlassPanel>

      {Object.keys(caseDetail.field_values).length > 0 && (
        <GlassPanel style={{ marginBottom: 12 }}>
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>Fields</Text>
          {Object.entries(caseDetail.field_values).map(([key, value]) => (
            <View key={key} className="flex-row justify-between py-1 border-b border-slate-700/30">
              <Text className="text-slate-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.mono }}>
                {key}
              </Text>
              <Text className="text-slate-200 text-sm flex-1 text-right ml-4" style={{ fontFamily: clinicalTokens.fonts.mono }}>
                {String(value ?? '—')}
              </Text>
            </View>
          ))}
        </GlassPanel>
      )}

      {caseDetail.status === 'rejected' && caseDetail.rejection_comment && (
        <GlassPanel style={{ marginBottom: 12 }}>
          <Text className="text-red-400 text-xs uppercase tracking-wider mb-1" style={{ fontFamily: clinicalTokens.fonts.body }}>Rejection Comment</Text>
          <Text className="text-slate-300 text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>{caseDetail.rejection_comment}</Text>
        </GlassPanel>
      )}

      {canEdit && (
        <TouchableOpacity
          className="bg-indigo-600 rounded-xl py-4 items-center mb-3"
          onPress={() => router.push({ pathname: '/log-case', params: { editCaseId: caseDetail.id } })}
          accessibilityLabel="Edit this case"
          accessibilityRole="button"
        >
          <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.heading }}>Edit Case</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        className="bg-slate-800 rounded-xl py-4 items-center mb-3 border border-indigo-500/15"
        onPress={() => router.push({ pathname: '/log-case', params: { duplicateCaseId: caseDetail.id } })}
        accessibilityLabel="Duplicate this case"
        accessibilityRole="button"
      >
        <Text className="text-teal-400" style={{ fontFamily: clinicalTokens.fonts.heading }}>Duplicate Case</Text>
      </TouchableOpacity>

      {canApprove && caseDetail.status === 'pending' && (
        <View className="flex-row gap-3 mb-3">
          <TouchableOpacity
            className="flex-1 bg-emerald-600/20 rounded-xl py-4 items-center border border-emerald-500/40"
            onPress={() => confirmAction('approve')}
            disabled={processing || isOffline}
            accessibilityLabel="Approve case"
            accessibilityRole="button"
          >
            <Text className="text-emerald-400" style={{ fontFamily: clinicalTokens.fonts.heading }}>
              {processing ? 'Processing...' : 'Approve'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-red-600/20 rounded-xl py-4 items-center border border-red-500/40"
            onPress={() => confirmAction('reject')}
            disabled={processing || isOffline}
            accessibilityLabel="Reject case"
            accessibilityRole="button"
          >
            <Text className="text-red-400" style={{ fontFamily: clinicalTokens.fonts.heading }}>
              {processing ? 'Processing...' : 'Reject'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {caseDetail.status === 'rejected' && (
        <TouchableOpacity
          className="bg-teal-600 rounded-xl py-4 items-center mb-3"
          onPress={() => router.push({ pathname: '/log-case', params: { editCaseId: caseDetail.id } })}
          accessibilityLabel="Resubmit case"
          accessibilityRole="button"
        >
          <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.heading }}>Resubmit Case</Text>
        </TouchableOpacity>
      )}

      <Modal transparent animationType="fade" visible={rejectModalOpen}>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View
            className="w-full rounded-2xl p-6 border border-indigo-500/15"
            style={{ backgroundColor: clinicalTokens.colors.neutral.dark }}
          >
            <Text className="text-white text-lg mb-2" style={{ fontFamily: clinicalTokens.fonts.heading }}>
              Reject Case
            </Text>
            <Text className="text-slate-400 text-sm mb-4" style={{ fontFamily: clinicalTokens.fonts.body }}>
              Please provide a reason. The resident will see this message.
            </Text>
            <TextInput
              className="text-white rounded-xl px-4 py-3 border border-indigo-500/15 min-h-[100px]" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
              multiline
              textAlignVertical="top"
              placeholder="Reason for rejection"
              placeholderTextColor="#666"
              value={rejectComment}
              onChangeText={setRejectComment}
              accessibilityLabel="Rejection reason"
            />
            <View className="flex-row gap-3 mt-4">
              <TouchableOpacity
                className="flex-1 rounded-lg py-3 items-center bg-slate-800"
                onPress={() => { setRejectModalOpen(false); setRejectComment(''); }}
                accessibilityLabel="Cancel rejection"
                accessibilityRole="button"
              >
                <Text className="text-slate-300" style={{ fontFamily: clinicalTokens.fonts.heading }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-lg py-3 items-center bg-red-600"
                onPress={submitReject}
                accessibilityLabel="Confirm rejection"
                accessibilityRole="button"
              >
                <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.heading }}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}