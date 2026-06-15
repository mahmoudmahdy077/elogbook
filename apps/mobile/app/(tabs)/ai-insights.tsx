import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import { aiQuerySchema } from '@elogbook/shared';
import type { UserRole } from '@elogbook/shared';
import GlassPanel from '../../components/GlassPanel';

const MAX_QUERIES = 20;

export default function AIInsightsScreen() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
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

    if (profile.role === 'resident' || profile.role === 'director' || profile.role === 'admin') {
      const today = new Date().toISOString().slice(0, 10);
      const { count } = await supabase
        .from('ai_query_logs')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', profile.id)
        .gte('created_at', today);

      setQuotaUsed(count ?? 0);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadProfile();

    const netUnsub = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false);
    });

    return () => {
      netUnsub();
    };
  }, [loadProfile]);

  const canAccess = role === 'director' || role === 'resident' || role === 'admin';
  const quotaRemaining = MAX_QUERIES - quotaUsed;

  const handleSubmit = useCallback(async () => {
    if (!query.trim() || !canAccess) return;

    const validation = aiQuerySchema.safeParse({
      query: query.trim(),
      resident_id: '',
      tenant_id: '',
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? 'Invalid query');
      return;
    }

    setError(null);
    setSubmitting(true);
    setResponse('');

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, tenant_id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return;

      const { data, error: rpcError } = await supabase.functions.invoke('ai-insights', {
        body: {
          query: query.trim(),
          resident_id: profile.id,
          tenant_id: profile.tenant_id,
        },
      });

      if (rpcError) throw rpcError;

      setResponse(data?.response ?? data?.text ?? JSON.stringify(data));
      setQuotaUsed((prev) => prev + 1);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to get AI insights. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [query, canAccess]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#060814' }}>
        <ActivityIndicator color="#0D9488" size="large" />
      </View>
    );
  }

  if (!canAccess) {
    return (
      <View className="flex-1 items-center justify-center px-4" style={{ backgroundColor: '#060814' }}>
        <Text className="text-slate-400 text-center">
          AI Insights is available for residents and directors only.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: '#060814' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="text-white text-2xl font-bold mb-1">AI Insights</Text>
        <Text className="text-slate-500 text-xs mb-4" style={{ fontFamily: 'Geist Mono' }}>
          {quotaUsed} of {MAX_QUERIES} queries used today
        </Text>

        {isOffline && (
          <View className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
            <Text className="text-red-400 text-sm text-center">
              Offline — AI insights require a connection
            </Text>
          </View>
        )}

        <View className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-3 mb-4">
          <Text className="text-amber-400 text-xs text-center">
            AI-generated insights are for educational purposes only and do not constitute medical advice.
          </Text>
        </View>

        <GlassPanel style={{ marginBottom: 12 }}>
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
            Ask a clinical question
          </Text>
          <TextInput
            className="text-white text-sm min-h-[80px]"
            style={{ fontFamily: 'Geist Mono' }}
            multiline
            textAlignVertical="top"
            placeholder="e.g., What are the key competencies for laparoscopic cholecystectomy?"
            placeholderTextColor="#666"
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              if (error) setError(null);
            }}
            maxLength={500}
            editable={!submitting && quotaRemaining > 0}
            accessibilityLabel="AI clinical reflection query"
          />
          <View className="flex-row justify-between items-center mt-2">
            <Text className="text-slate-500 text-xs" style={{ fontFamily: 'Geist Mono' }}>
              {query.length}/500
            </Text>
            <TouchableOpacity
              className={`rounded-lg px-4 py-2 ${quotaRemaining > 0 && !submitting ? 'bg-teal-600' : 'bg-slate-700'}`}
              onPress={handleSubmit}
              disabled={submitting || quotaRemaining <= 0}
              accessibilityLabel="Submit AI query"
              accessibilityRole="button"
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className={`text-sm font-semibold ${quotaRemaining > 0 ? 'text-white' : 'text-slate-500'}`}>
                  Ask
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </GlassPanel>

        {error && (
          <View className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
            <Text className="text-red-400 text-sm">{error}</Text>
          </View>
        )}

        {response ? (
          <GlassPanel style={{ marginBottom: 12 }}>
            <Text className="text-indigo-400 text-xs uppercase tracking-wider mb-2">Response</Text>
            <Text className="text-slate-200 text-sm" style={{ fontFamily: 'Geist Mono' }}>
              {response}
            </Text>
          </GlassPanel>
        ) : null}

        {quotaRemaining <= 0 && !response && (
          <View className="items-center py-8">
            <Text className="text-slate-400 text-center">
              You have reached your daily query limit. Insights will reset tomorrow.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}