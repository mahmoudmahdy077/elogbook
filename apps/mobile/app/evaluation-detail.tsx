/**
 * Evaluation detail — shows the structured record the web evaluation pages
 * render, instead of the old Alert with only a total score.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens } from '@elogbook/shared';
import { supabase } from '../lib/supabase';

interface RatingDomain {
  name?: string;
  score?: number;
  max?: number;
}

interface Evaluation {
  id: string;
  form_type: string;
  encounter_date: string | null;
  setting: string | null;
  patient_context: string | null;
  ratings: { domains?: RatingDomain[] } | null;
  overall_score: number | null;
  feedback: string | null;
  action_plan: string | null;
  status: string;
  resident_name: string | null;
  evaluator_name: string | null;
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function Section({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <View style={{ marginTop: 16 }}>
      <Text
        style={{
          fontFamily: clinicalTokens.fonts.body,
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: clinicalTokens.colors.text.muted,
          marginBottom: 4,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontFamily: clinicalTokens.fonts.body,
          fontSize: 15,
          lineHeight: 22,
          color: clinicalTokens.colors.text.primary,
        }}
      >
        {body}
      </Text>
    </View>
  );
}

export default function EvaluationDetailScreen() {
  const { evaluationId } = useLocalSearchParams<{ evaluationId: string }>();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!evaluationId) {
      setError('Missing evaluation id.');
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await supabase
      .from('evaluation_forms')
      .select(
        'id, form_type, encounter_date, setting, patient_context, ratings, overall_score, feedback, action_plan, status, resident_id, evaluator_id',
      )
      .eq('id', evaluationId)
      .maybeSingle();

    if (queryError || !data) {
      setError(queryError?.message ?? 'Evaluation not found.');
      setLoading(false);
      return;
    }

    const ids = [data.resident_id, data.evaluator_id].filter(Boolean) as string[];
    const { data: people } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    const names = new Map(
      (people ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]),
    );

    setEvaluation({
      ...(data as unknown as Evaluation),
      resident_name: names.get(data.resident_id as string) ?? null,
      evaluator_name: names.get(data.evaluator_id as string) ?? null,
    });
    setLoading(false);
  }, [evaluationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: clinicalTokens.colors.backdrop.dark }}>
      <View
        style={{
          paddingTop: 58,
          paddingHorizontal: 20,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          style={{ width: 40, height: 40, justifyContent: 'center' }}
        >
          <Ionicons name="chevron-back" size={26} color={clinicalTokens.colors.primary.DEFAULT} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.heading,
            fontWeight: '700',
            fontSize: 24,
            color: clinicalTokens.colors.text.primary,
          }}
        >
          Evaluation
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} />
        ) : error || !evaluation ? (
          <Text style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>
            {error ?? 'Evaluation not found.'}
          </Text>
        ) : (
          <>
            <Text
              style={{
                fontFamily: clinicalTokens.fonts.heading,
                fontWeight: '600',
                fontSize: 20,
                color: clinicalTokens.colors.text.primary,
              }}
            >
              {titleCase(evaluation.form_type)}
            </Text>
            <Text
              style={{
                marginTop: 4,
                fontFamily: clinicalTokens.fonts.body,
                fontSize: 13,
                color: clinicalTokens.colors.text.muted,
              }}
            >
              {[
                evaluation.encounter_date
                  ? new Date(evaluation.encounter_date).toLocaleDateString()
                  : null,
                evaluation.setting,
                evaluation.status,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>

            <View
              style={{
                marginTop: 16,
                backgroundColor: '#FFFFFF',
                borderRadius: 14,
                borderWidth: 1,
                borderColor: 'rgba(0,122,255,0.15)',
                padding: 14,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>
                  Overall score
                </Text>
                <Text
                  style={{
                    fontFamily: clinicalTokens.fonts.mono,
                    fontSize: 16,
                    color: clinicalTokens.colors.text.primary,
                  }}
                >
                  {evaluation.overall_score ?? '—'}
                </Text>
              </View>
              {(evaluation.ratings?.domains ?? []).map((domain, index) => (
                <View
                  key={`${domain.name ?? 'domain'}-${index}`}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    borderTopWidth: 1,
                    borderTopColor: 'rgba(0,0,0,0.06)',
                    paddingTop: 8,
                    marginTop: 8,
                  }}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: clinicalTokens.fonts.body,
                      fontSize: 14,
                      color: clinicalTokens.colors.text.primary,
                    }}
                  >
                    {domain.name ?? `Domain ${index + 1}`}
                  </Text>
                  <Text style={{ fontFamily: clinicalTokens.fonts.mono, fontSize: 14, color: clinicalTokens.colors.text.secondary }}>
                    {domain.score ?? '—'}
                    {domain.max ? ` / ${domain.max}` : ''}
                  </Text>
                </View>
              ))}
              {evaluation.resident_name && (
                <Text
                  style={{
                    marginTop: 10,
                    fontFamily: clinicalTokens.fonts.body,
                    fontSize: 12,
                    color: clinicalTokens.colors.text.muted,
                  }}
                >
                  Resident: {evaluation.resident_name}
                  {evaluation.evaluator_name ? ` · Evaluator: ${evaluation.evaluator_name}` : ''}
                </Text>
              )}
            </View>

            <Section title="Patient context" body={evaluation.patient_context} />
            <Section title="Feedback" body={evaluation.feedback} />
            <Section title="Action plan" body={evaluation.action_plan} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
