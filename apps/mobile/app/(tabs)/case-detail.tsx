import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import { useHaptics } from '../../lib/haptics';
import GlassPanel from '../../components/GlassPanel';
import StatusBadge from '../../components/StatusBadge';
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

    const { data: entry } = await supabase
      .from('case_entries')
      .select(
        'id, case_date, status, is_deidentified, patient_mrn, patient_dob, patient_age_years, patient_hash, field_values, created_at, updated_at, template_id, resident_id, case_templates(name, specialty), profiles!case_entries_resident_id_fkey(full_name), approval_requests(comment, status)'
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
    }

    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    loadCase();

    const netUnsub = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false);
    });

    return () => {
      netUnsub();
    };
  }, [loadCase]);

  const handleApprovalAction = useCallback(
    async (action: 'approve' | 'reject') => {
      if (!caseId || !caseDetail) return;
      setProcessing(true);
      haptics.approvalAction();

      try {
        const { error } = await supabase.rpc(
          action === 'approve' ? 'approve_case' : 'reject_case',
          {
            p_entry_id: caseId,
            ...(action === 'reject' ? { p_comment: '' } : {}),
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
      const title = action === 'approve' ? 'Approve Case?' : 'Reject Case?';
      Alert.alert(title, `This case will be ${action}ed.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'approve' ? 'Approve' : 'Reject',
          style: action === 'approve' ? 'default' : 'destructive',
          onPress: () => handleApprovalAction(action),
        },
      ]);
    },
    [handleApprovalAction]
  );

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#060814' }}>
        <ActivityIndicator color="#0D9488" size="large" />
      </View>
    );
  }

  if (!caseDetail) {
    return (
      <View className="flex-1 items-center justify-center px-4" style={{ backgroundColor: '#060814' }}>
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
    <ScrollView className="flex-1 px-4 pt-4" style={{ backgroundColor: '#060814' }} contentContainerStyle={{ paddingBottom: 40 }}>
      {isOffline && (
        <View className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
          <Text className="text-red-400 text-sm text-center">Offline — actions require a connection</Text>
        </View>
      )}

      <View className="flex-row justify-between items-start mb-4">
        <View className="flex-1 mr-3">
          <Text className="text-white text-xl font-bold">{caseDetail.specialty}</Text>
          <Text className="text-indigo-400 text-sm" style={{ fontFamily: 'Geist Mono' }}>
            {caseDetail.template_name}
          </Text>
        </View>
        <StatusBadge status={caseDetail.status} />
      </View>

      <GlassPanel style={{ marginBottom: 12 }}>
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Patient Info</Text>
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
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Case Data</Text>
        <Text className="text-slate-300 text-sm mb-1" style={{ fontFamily: 'Geist Mono' }}>
          Date: {caseDetail.case_date}
        </Text>
        <Text className="text-slate-300 text-sm mb-1" style={{ fontFamily: 'Geist Mono' }}>
          Resident: {caseDetail.resident_name}
        </Text>
        <Text className="text-slate-500 text-xs mt-2" style={{ fontFamily: 'Geist Mono' }}>
          Created: {new Date(caseDetail.created_at).toLocaleString()}
        </Text>
        <Text className="text-slate-500 text-xs" style={{ fontFamily: 'Geist Mono' }}>
          Updated: {new Date(caseDetail.updated_at).toLocaleString()}
        </Text>
      </GlassPanel>

      {Object.keys(caseDetail.field_values).length > 0 && (
        <GlassPanel style={{ marginBottom: 12 }}>
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Fields</Text>
          {Object.entries(caseDetail.field_values).map(([key, value]) => (
            <View key={key} className="flex-row justify-between py-1 border-b border-slate-700/30">
              <Text className="text-slate-400 text-sm" style={{ fontFamily: 'Geist Mono' }}>
                {key}
              </Text>
              <Text className="text-slate-200 text-sm flex-1 text-right ml-4" style={{ fontFamily: 'Geist Mono' }}>
                {String(value ?? '—')}
              </Text>
            </View>
          ))}
        </GlassPanel>
      )}

      {caseDetail.status === 'rejected' && caseDetail.rejection_comment && (
        <GlassPanel style={{ marginBottom: 12 }}>
          <Text className="text-red-400 text-xs uppercase tracking-wider mb-1">Rejection Comment</Text>
          <Text className="text-slate-300 text-sm">{caseDetail.rejection_comment}</Text>
        </GlassPanel>
      )}

      {canEdit && (
        <TouchableOpacity
          className="bg-indigo-600 rounded-xl py-4 items-center mb-3"
          onPress={() => router.push({ pathname: '/log-case', params: { editCaseId: caseDetail.id } })}
          accessibilityLabel="Edit this case"
          accessibilityRole="button"
        >
          <Text className="text-white font-semibold">Edit Case</Text>
        </TouchableOpacity>
      )}

      {canApprove && caseDetail.status === 'pending' && (
        <View className="flex-row gap-3 mb-3">
          <TouchableOpacity
            className="flex-1 bg-emerald-600/20 rounded-xl py-4 items-center border border-emerald-500/40"
            onPress={() => confirmAction('approve')}
            disabled={processing || isOffline}
            accessibilityLabel="Approve case"
            accessibilityRole="button"
          >
            <Text className="text-emerald-400 font-semibold">
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
            <Text className="text-red-400 font-semibold">
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
          <Text className="text-white font-semibold">Resubmit Case</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}