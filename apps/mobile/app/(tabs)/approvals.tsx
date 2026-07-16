import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Alert,
  TextInput,
  Modal,
  Animated,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import { useHaptics } from '../../lib/haptics';
import { NativeGlassPanel as GlassPanel, NativeStatusBadge as StatusBadge } from '@elogbook/shared/components/native';
import { clinicalTokens } from '@elogbook/shared';
import ScreenWrapper from '../../components/ScreenWrapper';
import type { UserRole } from '@elogbook/shared';

interface ApprovalItem {
  id: string;
  entry_id: string;
  resident_name: string;
  specialty: string;
  case_date: string;
  status: 'pending' | 'approved' | 'rejected';
  comment: string | null;
}

const AnimatedCard = React.memo(function AnimatedCard({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(24)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        delay: index * 80,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 400,
        delay: index * 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
});

const ApprovalCard = React.memo(function ApprovalCard({
  item,
  isProcessing,
  isOffline,
  onConfirm,
}: {
  item: ApprovalItem;
  isProcessing: boolean;
  isOffline: boolean;
  onConfirm: (approvalId: string, entryId: string, action: 'approve' | 'reject') => void;
}) {
  const isPending = item.status === 'pending';
  return (
    <GlassPanel style={{ marginBottom: 12 }}>
      <View className="flex-row justify-between items-start">
        <View className="flex-1 mr-3">
          <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.heading }}>{item.resident_name}</Text>
          <Text className="text-[#007AFF] text-xs mt-0.5" style={{ fontFamily: clinicalTokens.fonts.mono }}>
            {item.specialty}
          </Text>
          <Text className="text-gray-400 text-xs mt-1" style={{ fontFamily: clinicalTokens.fonts.mono }}>
            {item.case_date}
          </Text>
          {item.comment && (
            <Text className="text-gray-500 text-xs mt-1" numberOfLines={2} style={{ fontFamily: clinicalTokens.fonts.body }}>
              {item.comment}
            </Text>
          )}
        </View>
        <StatusBadge status={item.status === 'pending' ? 'pending' : item.status === 'approved' ? 'approved' : 'rejected'} />
      </View>

      {isPending && (
        <View className="flex-row gap-3 mt-3 pt-3 border-t border-gray-300/50">
          <TouchableOpacity
            className="flex-1 bg-primary/15 rounded-lg py-2.5 items-center border border-emerald-500/40"
            onPress={() => onConfirm(item.id, item.entry_id, 'approve')}
            disabled={isProcessing || isOffline}
            accessibilityLabel={`Approve case from ${item.resident_name}`}
            accessibilityRole="button"
          >
            <Text className="text-[#34C759] text-sm" style={{ fontFamily: clinicalTokens.fonts.heading }}>
              {isProcessing ? '...' : 'Approve'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-[#FF3B30]/15 rounded-lg py-2.5 items-center border border-red-500/40"
            onPress={() => onConfirm(item.id, item.entry_id, 'reject')}
            disabled={isProcessing || isOffline}
            accessibilityLabel={`Reject case from ${item.resident_name}`}
            accessibilityRole="button"
          >
            <Text className="text-red-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.heading }}>
              {isProcessing ? '...' : 'Reject'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </GlassPanel>
  );
});

export default function ApprovalsScreen() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<{ approvalId: string; entryId: string } | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const haptics = useHaptics();

  const loadProfileAndApprovals = useCallback(async () => {
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

    if (profile.role !== 'supervisor' && profile.role !== 'director' && profile.role !== 'admin') {
      setLoading(false);
      return;
    }

    const { data: requests } = await supabase
      .from('approval_requests')
      .select(
        'id, entry_id, status, comment, requested_at, case_entries(resident_id, case_date, template_id, case_templates(specialty, name)), profiles!supervisor_id(full_name)'
      )
      .eq('case_entries.tenant_id', profile.tenant_id)
      .order('requested_at', { ascending: false });

    if (requests) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: ApprovalItem[] = requests.map((r: any) => ({
        id: r.id,
        entry_id: r.entry_id,
        resident_name: r.profiles?.full_name ?? 'Unknown',
        specialty: r.case_entries?.case_templates?.specialty ?? '',
        case_date: r.case_entries?.case_date ?? '',
        status: r.status,
        comment: r.comment,
      }));
      setApprovals(mapped);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadProfileAndApprovals();

    const netUnsub = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected !== true);
    });

    return () => {
      netUnsub();
    };
  }, [loadProfileAndApprovals]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfileAndApprovals();
    setRefreshing(false);
  }, [loadProfileAndApprovals]);

  const handleAction = useCallback(
    async (approvalId: string, entryId: string, action: 'approve' | 'reject', comment?: string) => {
      setProcessingIds((prev) => new Set(prev).add(approvalId));
      haptics.approvalAction();

      try {
        const { error } = await supabase.rpc(
          action === 'approve' ? 'approve_case' : 'reject_case',
          {
            p_entry_id: entryId,
            ...(action === 'reject' ? { p_comment: comment ?? '' } : {}),
          }
        );

        if (error) throw error;

        haptics.submitSuccess();
        setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
      } catch {
        haptics.submitError();
        Alert.alert('Error', `Failed to ${action} case. Please try again.`);
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [haptics]
  );

  const confirmAction = useCallback(
    (approvalId: string, entryId: string, action: 'approve' | 'reject') => {
      if (action === 'reject') {
        setRejectTarget({ approvalId, entryId });
        setRejectComment('');
        return;
      }
      const title = 'Approve Case?';
      const message = 'This case will be marked as approved.';
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: () => handleAction(approvalId, entryId, action),
        },
      ]);
    },
    [handleAction]
  );

  const submitReject = useCallback(() => {
    if (!rejectTarget) return;
    const trimmed = rejectComment.trim();
    if (!trimmed) {
      Alert.alert('Reason required', 'Please provide a reason for rejecting this case.');
      return;
    }
    const { approvalId, entryId } = rejectTarget;
    setRejectTarget(null);
    setRejectComment('');
    handleAction(approvalId, entryId, 'reject', trimmed);
  }, [rejectTarget, rejectComment, handleAction]);

  const renderItem = useCallback(
    ({ item, index }: { item: ApprovalItem; index: number }) => (
      <AnimatedCard index={index}>
        <ApprovalCard
          item={item}
          isProcessing={processingIds.has(item.id)}
          isOffline={isOffline}
          onConfirm={confirmAction}
        />
      </AnimatedCard>
    ),
    [processingIds, isOffline, confirmAction],
  );

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  if (role && role !== 'supervisor' && role !== 'director' && role !== 'institution_admin' && role !== 'admin') {
    return (
      <View className="flex-1 items-center justify-center px-4" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <Text className="text-gray-500 text-center" style={{ fontFamily: clinicalTokens.fonts.body }}>
          You do not have permission to view approvals.
        </Text>
      </View>
    );
  }

  return (
    <ScreenWrapper title="Approvals" scroll={false}>
      {isOffline && (
        <View className="bg-red-500/10 border-b border-red-500/30 px-4 py-2">
          <Text className="text-red-400 text-sm text-center" style={{ fontFamily: clinicalTokens.fonts.heading }}>
            Offline — approvals require a connection
          </Text>
        </View>
      )}

      <Text className="text-xs mb-3" style={{ fontFamily: clinicalTokens.fonts.mono, color: clinicalTokens.colors.text.muted }}>
        {approvals.filter((a) => a.status === 'pending').length} pending
      </Text>

      <FlatList
        data={approvals}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={clinicalTokens.colors.primary.DEFAULT} />
        }
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-gray-500 text-center" style={{ fontFamily: clinicalTokens.fonts.body }}>No approval requests found.</Text>
          </View>
        }
        renderItem={renderItem}
      />

      <Modal transparent animationType="fade" visible={rejectTarget !== null}>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View
            className="w-full rounded-2xl p-6 border border-[#007AFF]/15"
            style={{ backgroundColor: clinicalTokens.colors.neutral.dark }}
          >
            <Text className="text-lg mb-2" style={{ fontFamily: clinicalTokens.fonts.heading, fontWeight: '600', color: clinicalTokens.colors.text.primary }}>
              Reject Case
            </Text>
            <Text className="text-sm mb-4" style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>
              Please provide a reason. The resident will see this message.
            </Text>
            <TextInput
              className="rounded-xl px-4 py-3 border border-[#007AFF]/15 min-h-[100px]"
              style={{ backgroundColor: clinicalTokens.colors.backdrop.dark, color: clinicalTokens.colors.text.primary }}
              multiline
              textAlignVertical="top"
              placeholder="Reason for rejection"
              placeholderTextColor={clinicalTokens.colors.text.muted}
              value={rejectComment}
              onChangeText={setRejectComment}
              accessibilityLabel="Rejection reason"
            />
            <View className="flex-row gap-3 mt-4">
              <TouchableOpacity
                className="flex-1 rounded-lg py-3 items-center"
                style={{ backgroundColor: clinicalTokens.colors.neutral.light }}
                onPress={() => { setRejectTarget(null); setRejectComment(''); }}
                accessibilityLabel="Cancel rejection"
                accessibilityRole="button"
              >
                <Text className="text-sm" style={{ fontFamily: clinicalTokens.fonts.heading, color: clinicalTokens.colors.text.primary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-lg py-3 items-center bg-[#FF3B30]"
                onPress={submitReject}
                accessibilityLabel="Confirm rejection"
                accessibilityRole="button"
              >
                <Text className="text-white text-sm" style={{ fontFamily: clinicalTokens.fonts.heading }}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}