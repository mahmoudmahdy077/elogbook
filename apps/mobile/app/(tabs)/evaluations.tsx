import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { clinicalTokens } from '@elogbook/shared';

interface EvaluationData {
  id: string;
  form_type: string;
  resident_id: string;
  evaluator_id: string;
  encounter_date: string | null;
  setting: string | null;
  overall_score: number | null;
  status: string;
  created_at: string;
}

interface ResidentData {
  id: string;
  full_name: string;
}

// ── Evaluation Card ──────────────────────────────────────────────────

function EvaluationCard({
  evaluation,
  onPress,
}: {
  evaluation: EvaluationData;
  onPress: () => void;
}) {
  const statusColor =
    evaluation.status === 'completed'
      ? '#10B981'
      : evaluation.status === 'draft'
        ? '#F59E0B'
        : '#6B7280';

  return (
    <TouchableOpacity
      className="bg-white/5 rounded-xl p-4 border border-gray-700/50 mb-2"
      onPress={onPress}
      accessibilityLabel={`${evaluation.form_type} evaluation`}
      accessibilityRole="button"
    >
      <View className="flex-row justify-between items-start">
        <View className="flex-1 mr-2">
          <Text
            className="text-white text-sm"
            style={{ fontFamily: clinicalTokens.fonts.heading }}
          >
            {evaluation.form_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </Text>
          {evaluation.encounter_date && (
            <Text
              className="text-gray-500 text-xs mt-1"
              style={{ fontFamily: clinicalTokens.fonts.mono }}
            >
              {new Date(evaluation.encounter_date).toLocaleDateString()}
            </Text>
          )}
          {evaluation.setting && (
            <Text
              className="text-gray-400 text-xs mt-0.5"
              style={{ fontFamily: clinicalTokens.fonts.body }}
            >
              {evaluation.setting}
            </Text>
          )}
        </View>
        <View className="flex-col items-end gap-1">
          <View
            className="rounded-full px-2 py-0.5"
            style={{ backgroundColor: statusColor + '20' }}
          >
            <Text
              className="text-xs"
              style={{ fontFamily: clinicalTokens.fonts.body, color: statusColor }}
            >
              {evaluation.status.charAt(0).toUpperCase() + evaluation.status.slice(1)}
            </Text>
          </View>
          {evaluation.overall_score != null && (
            <Text
              className="text-primary text-sm"
              style={{ fontFamily: clinicalTokens.fonts.heading }}
            >
              {evaluation.overall_score.toFixed(1)}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── New Evaluation Sheet ─────────────────────────────────────────────

const FORM_TYPES = [
  { key: 'mini_cex', label: 'Mini-CEX' },
  { key: 'dops', label: 'DOPS' },
  { key: 'cbd', label: 'Case-Based Discussion' },
  { key: 'msf', label: 'Multi-Source Feedback' },
  { key: 'osce', label: 'OSCE' },
  { key: 'procedure_log', label: 'Procedure Log' },
];

function NewEvaluationSheet({
  visible,
  onClose,
  role,
  evaluatorId,
  tenantId,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  role: string | null;
  evaluatorId: string;
  tenantId: string | null;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<'picker' | 'form'>('picker');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [residents, setResidents] = useState<ResidentData[]>([]);
  const [selectedResident, setSelectedResident] = useState<string | null>(null);
  const [encounterDate, setEncounterDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [setting, setSetting] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  const showResidentPicker =
    role === 'supervisor' || role === 'director' || role === 'institution_admin' || role === 'admin';

  useEffect(() => {
    if (visible && showResidentPicker && tenantId) {
      (async () => {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('tenant_id', tenantId)
          .eq('role', 'resident');
        setResidents((data ?? []) as ResidentData[]);
      })();
    }
  }, [visible, showResidentPicker, tenantId]);

  const handleTypeSelect = useCallback((type: string) => {
    setSelectedType(type);
    if (!showResidentPicker) {
      setStep('form');
    }
  }, [showResidentPicker]);

  const handleResidentSelect = useCallback((id: string) => {
    setSelectedResident(id);
    setStep('form');
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedType || !evaluatorId) {
      Alert.alert('Error', 'Missing required fields.');
      return;
    }

    const residentId =
      selectedResident ?? evaluatorId;

    setSaving(true);
    const { error } = await supabase.from('evaluation_forms').insert({
      tenant_id: tenantId,
      resident_id: residentId,
      evaluator_id: evaluatorId,
      form_type: selectedType,
      encounter_date: encounterDate || null,
      setting: setting || null,
      ratings: {},
      status: 'draft',
    });

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Saved', 'Evaluation created successfully.');
      onSaved();
      onClose();
      // Reset state
      setStep('picker');
      setSelectedType(null);
      setSelectedResident(null);
      setSetting('');
      setFeedback('');
      setEncounterDate(new Date().toISOString().slice(0, 10));
    }
  }, [selectedType, evaluatorId, selectedResident, tenantId, encounterDate, setting, onSaved, onClose]);

  const handleClose = useCallback(() => {
    setStep('picker');
    setSelectedType(null);
    setSelectedResident(null);
    setSetting('');
    setFeedback('');
    setEncounterDate(new Date().toISOString().slice(0, 10));
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View className="flex-1 justify-end bg-black/50">
        <View
          className="rounded-t-3xl p-6 max-h-[80%]"
          style={{ backgroundColor: clinicalTokens.colors.neutral.dark }}
        >
          <View className="w-12 h-1 bg-gray-600 rounded-full self-center mb-4" />

          {step === 'picker' && selectedType === null && (
            <>
              <Text
                className="text-white text-lg mb-4"
                style={{ fontFamily: clinicalTokens.fonts.heading }}
              >
                Select Form Type
              </Text>
              {FORM_TYPES.map((ft) => (
                <TouchableOpacity
                  key={ft.key}
                  className="bg-white/10 rounded-xl px-4 py-3 mb-2 border border-gray-700"
                  onPress={() => handleTypeSelect(ft.key)}
                  accessibilityLabel={`Select ${ft.label}`}
                  accessibilityRole="button"
                >
                  <Text
                    className="text-white text-sm"
                    style={{ fontFamily: clinicalTokens.fonts.body }}
                  >
                    {ft.label}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                className="mt-4 py-3 items-center"
                onPress={handleClose}
              >
                <Text
                  className="text-gray-500 text-sm"
                  style={{ fontFamily: clinicalTokens.fonts.body }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'picker' && selectedType !== null && showResidentPicker && !selectedResident && (
            <>
              <Text
                className="text-white text-lg mb-1"
                style={{ fontFamily: clinicalTokens.fonts.heading }}
              >
                {FORM_TYPES.find((f) => f.key === selectedType)?.label}
              </Text>
              <Text
                className="text-gray-400 text-sm mb-4"
                style={{ fontFamily: clinicalTokens.fonts.body }}
              >
                Select a resident
              </Text>

              {residents.length === 0 && (
                <View className="py-4 items-center">
                  <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="small" />
                </View>
              )}

              <ScrollView className="max-h-60">
                {residents.map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    className="bg-white/10 rounded-xl px-4 py-3 mb-2 border border-gray-700"
                    onPress={() => handleResidentSelect(r.id)}
                    accessibilityLabel={`Select resident: ${r.full_name}`}
                    accessibilityRole="button"
                  >
                    <Text
                      className="text-white text-sm"
                      style={{ fontFamily: clinicalTokens.fonts.body }}
                    >
                      {r.full_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity
                className="mt-4 py-3 items-center"
                onPress={() => setSelectedType(null)}
              >
                <Text
                  className="text-gray-500 text-sm"
                  style={{ fontFamily: clinicalTokens.fonts.body }}
                >
                  Back
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'form' && (
            <>
              <Text
                className="text-white text-lg mb-1"
                style={{ fontFamily: clinicalTokens.fonts.heading }}
              >
                {FORM_TYPES.find((f) => f.key === selectedType)?.label}
              </Text>
              <Text
                className="text-gray-400 text-sm mb-4"
                style={{ fontFamily: clinicalTokens.fonts.body }}
              >
                New evaluation
              </Text>

              <ScrollView className="max-h-[50%]">
                {/* Encounter date */}
                <Text
                  className="text-gray-400 text-xs mb-1"
                  style={{ fontFamily: clinicalTokens.fonts.body }}
                >
                  Encounter Date
                </Text>
                <TextInput
                  className="bg-white/10 text-white rounded-xl px-4 py-3 mb-3 border border-gray-700"
                  value={encounterDate}
                  onChangeText={setEncounterDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#666"
                  accessibilityLabel="Encounter date"
                />

                {/* Setting */}
                <Text
                  className="text-gray-400 text-xs mb-1"
                  style={{ fontFamily: clinicalTokens.fonts.body }}
                >
                  Setting
                </Text>
                <TextInput
                  className="bg-white/10 text-white rounded-xl px-4 py-3 mb-3 border border-gray-700"
                  value={setting}
                  onChangeText={setSetting}
                  placeholder="e.g. Inpatient, Outpatient, ED"
                  placeholderTextColor="#666"
                  accessibilityLabel="Setting"
                />

                {/* Feedback */}
                <Text
                  className="text-gray-400 text-xs mb-1"
                  style={{ fontFamily: clinicalTokens.fonts.body }}
                >
                  Feedback (optional)
                </Text>
                <TextInput
                  className="bg-white/10 text-white rounded-xl px-4 py-3 mb-4 border border-gray-700"
                  value={feedback}
                  onChangeText={setFeedback}
                  placeholder="Brief feedback notes..."
                  placeholderTextColor="#666"
                  multiline
                  numberOfLines={3}
                  accessibilityLabel="Feedback"
                />
              </ScrollView>

              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 bg-gray-700 rounded-xl py-3 items-center"
                  onPress={() => setStep('picker')}
                  accessibilityLabel="Back to form type selection"
                  accessibilityRole="button"
                >
                  <Text
                    className="text-white"
                    style={{ fontFamily: clinicalTokens.fonts.heading }}
                  >
                    Back
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className={`flex-1 bg-primary rounded-xl py-3 items-center ${saving ? 'opacity-50' : ''}`}
                  onPress={handleSave}
                  disabled={saving}
                  accessibilityLabel="Save evaluation"
                  accessibilityRole="button"
                >
                  <Text
                    className="text-white"
                    style={{ fontFamily: clinicalTokens.fonts.heading }}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────

export default function EvaluationsScreen() {
  const [evaluations, setEvaluations] = useState<EvaluationData[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [evaluatorId, setEvaluatorId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewEval, setShowNewEval] = useState(false);

  const loadEvaluations = useCallback(async () => {
    setLoading(true);
    try {
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

      setRole(profile.role);
      setEvaluatorId(profile.id);
      setTenantId(profile.tenant_id);

      // Build query
      let query = supabase
        .from('evaluation_forms')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false });

      if (profile.role === 'resident') {
        // Residents see evaluations about them
        query = query.eq('resident_id', profile.id);
      } else if (profile.role === 'supervisor') {
        // Supervisors see evaluations they created
        query = query.eq('evaluator_id', profile.id);
      }
      // Directors/admins see all

      const { data, error } = await query;
      if (!error) {
        setEvaluations((data ?? []) as EvaluationData[]);
      }
    } catch (err) {
      console.error('Failed to load evaluations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvaluations();
  }, [loadEvaluations]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEvaluations();
    setRefreshing(false);
  }, [loadEvaluations]);

  // Group evaluations by form_type
  const groupedByType = useMemo(() => {
    const map = new Map<string, EvaluationData[]>();
    for (const ev of evaluations) {
      const list = map.get(ev.form_type) ?? [];
      list.push(ev);
      map.set(ev.form_type, list);
    }
    return Array.from(map.entries())
      .map(([type, list]) => ({ type, count: list.length, evaluations: list }))
      .sort((a, b) => b.count - a.count);
  }, [evaluations]);

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
      >
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
    >
      <ScrollView
        className="flex-1 px-4 pt-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={clinicalTokens.colors.primary.DEFAULT}
          />
        }
      >
        <View className="flex-row justify-between items-center mb-4">
          <Text
            className="text-white text-2xl"
            style={{ fontFamily: clinicalTokens.fonts.heading }}
          >
            Evaluations
          </Text>

          {role !== 'resident' && (
            <TouchableOpacity
              className="bg-primary rounded-xl px-4 py-2"
              onPress={() => setShowNewEval(true)}
              accessibilityLabel="New evaluation"
              accessibilityRole="button"
            >
              <Text
                className="text-white text-sm"
                style={{ fontFamily: clinicalTokens.fonts.heading }}
              >
                + New
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Empty state */}
        {groupedByType.length === 0 && (
          <View className="bg-white/5 rounded-xl p-6 border border-gray-700/50 items-center">
            <Text
              className="text-gray-500 text-sm"
              style={{ fontFamily: clinicalTokens.fonts.body }}
            >
              No evaluations found.
            </Text>
          </View>
        )}

        {/* Evaluations grouped by type */}
        {groupedByType.map((group) => (
          <View key={group.type} className="mb-5">
            <View className="flex-row items-center mb-2">
              <Text
                className="text-primary text-sm font-semibold flex-1"
                style={{ fontFamily: clinicalTokens.fonts.heading }}
              >
                {group.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </Text>
              <View className="bg-primary/20 rounded-full px-2 py-0.5">
                <Text
                  className="text-primary text-xs"
                  style={{ fontFamily: clinicalTokens.fonts.body }}
                >
                  {group.count}
                </Text>
              </View>
            </View>

            {group.evaluations.slice(0, 5).map((ev) => (
              <EvaluationCard
                key={ev.id}
                evaluation={ev}
                onPress={() => {
                  // Detail view could navigate to a full evaluation detail screen
                }}
              />
            ))}

            {group.evaluations.length > 5 && (
              <TouchableOpacity className="py-2">
                <Text
                  className="text-primary text-sm text-center"
                  style={{ fontFamily: clinicalTokens.fonts.body }}
                >
                  +{group.evaluations.length - 5} more
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>

      {/* New Evaluation Sheet */}
      <NewEvaluationSheet
        visible={showNewEval}
        onClose={() => setShowNewEval(false)}
        role={role}
        evaluatorId={evaluatorId ?? ''}
        tenantId={tenantId}
        onSaved={loadEvaluations}
      />
    </View>
  );
}
