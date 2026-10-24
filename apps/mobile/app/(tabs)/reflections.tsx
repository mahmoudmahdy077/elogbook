import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  Alert,
  FlatList,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { bestKnownCapability } from '../../lib/session';
import { runGuardedMutation } from '../../lib/operations';
import {
  validateReflectionDraft,
  buildReflectionPayload,
  canDeleteReflection,
  isLeadershipRole,
  countWords,
  REFLECTION_CHIP_OPTIONS,
} from '../../lib/reflection-payload';
import { clinicalTokens } from '@elogbook/shared';
import ScreenWrapper from '../../components/ScreenWrapper';

interface ReflectionRow {
  id: string;
  author_id: string;
  reflection_type: string;
  title: string;
  body: string;
  shared: boolean;
  created_at: string;
  profiles?: { full_name: string | null } | null;
}

export default function ReflectionsScreen() {
  const [profile, setProfile] = useState<{ id: string; tenant_id: string; role: string } | null>(null);
  const [rows, setRows] = useState<ReflectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reflectionType, setReflectionType] = useState<string>('clinical');
  const [shared, setShared] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const cap = await bestKnownCapability(supabase as never);
    if (!cap) {
      setError('You need to sign in first.');
      setLoading(false);
      return;
    }
    setProfile({ id: cap.profileId, tenant_id: cap.tenantId, role: cap.role });
    const isLeadership = isLeadershipRole(cap.role);
    const { data, error: err } = await supabase
      .from('reflections')
      .select(
        'id, author_id, reflection_type, title, body, shared, created_at' +
          (isLeadership ? ', profiles(full_name)' : '')
      )
      .eq('tenant_id', cap.tenantId)
      .order('created_at', { ascending: false });
    if (err) {
      setError('Could not load reflections.');
      setLoading(false);
      return;
    }
    const typed = (data ?? []) as unknown as ReflectionRow[];
    // RLS returns own rows plus (leadership) shared ones; the client filter
    // mirrors the web journal so non-leadership never see another role's
    // private entry even in the unlikely event of a stale local RLS view.
    const visible = isLeadership
      ? typed
      : typed.filter((r) => r.author_id === cap.profileId);
    setRows(visible);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    const draft = { title, reflection_type: reflectionType, body, shared };
    const validationError = validateReflectionDraft(draft);
    if (validationError) {
      Alert.alert('Check your reflection', validationError);
      return;
    }
    if (!profile) {
      Alert.alert('Error', 'You need to sign in first.');
      return;
    }

    setSaving(true);
    const capability = await bestKnownCapability(supabase as never);
    const outcome = await runGuardedMutation({
      capability,
      action: 'reflection:create',
      write: async () => {
        const { error: insertErr } = await supabase
          .from('reflections')
          .insert(buildReflectionPayload(profile, draft));
        if (insertErr) {
          if (/401|403/.test(insertErr.message)) {
            // fall through — capabilities/token refresh handled by session lib
          }
          throw new Error(insertErr.message);
        }
      },
    });

    setSaving(false);
    if (outcome.kind === 'confirmed') {
      Alert.alert('Saved', 'Reflection recorded.');
      setTitle('');
      setBody('');
      setShared(false);
      setReflectionType('clinical');
      load();
    } else if (outcome.kind === 'denied') {
      Alert.alert('Not permitted', outcome.reason);
    } else if (outcome.kind === 'transient') {
      Alert.alert('Connection issue', 'Could not save your reflection. Check your connection and retry.');
    } else {
      Alert.alert('Error', outcome.copy);
    }
  };

  const handleDelete = async (row: ReflectionRow) => {
    if (!profile || !canDeleteReflection(row, profile.id, profile.role)) return;
    Alert.alert('Delete reflection', 'Delete this reflection? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const capability = await bestKnownCapability(supabase as never);
          const outcome = await runGuardedMutation({
            capability,
            action: 'reflection:delete',
            write: async () => {
              const { error: delErr } = await supabase
                .from('reflections')
                .delete()
                .eq('id', row.id);
              if (delErr) throw new Error(delErr.message);
            },
          });
          if (outcome.kind === 'confirmed') {
            load();
          } else {
            Alert.alert('Error', 'Could not delete this reflection.');
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: ReflectionRow }) => (
    <View className="bg-white rounded-2xl p-4 mb-3 border border-border/50">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 mr-2">
          <Text
            className="text-[#000000] text-base font-semibold"
            style={{ fontFamily: clinicalTokens.fonts.heading }}
            accessibilityRole="header"
          >
            {item.title}
          </Text>
          <Text className="text-[#8E8E93] text-xs mt-1" style={{ fontFamily: clinicalTokens.fonts.body }}>
            {item.reflection_type}
            {item.shared ? ` • shared${item.profiles?.full_name ? ` • ${item.profiles.full_name}` : ''}` : ''}
            {` • ${new Date(item.created_at).toLocaleDateString()}`}
          </Text>
        </View>
        {profile && canDeleteReflection(item, profile.id, profile.role) && (
          <TouchableOpacity
            onPress={() => handleDelete(item)}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.title}`}
            className="px-2 py-2 rounded-lg"
          >
            <Text className="text-[#007AFF] text-xs" style={{ fontFamily: clinicalTokens.fonts.body }}>
              Delete
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <Text className="text-[#3C3C43] text-sm mt-2" style={{ fontFamily: clinicalTokens.fonts.body }}>
        {item.body}
      </Text>
    </View>
  );

  return (
    <ScreenWrapper title="Reflections" scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <>
            <Animated.View entering={FadeIn.delay(100).springify()}>
              <Text
                className="text-[#000000] text-xl mb-4"
                style={{ fontFamily: clinicalTokens.fonts.heading }}
                accessibilityRole="header"
              >
                Structured Reflections
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(150).springify()}>
              <TextInput
                className="bg-white text-[#000000] rounded-xl px-4 py-3 mb-3 border border-[#007AFF]/15"
                placeholder="Title"
                placeholderTextColor="#666666"
                value={title}
                onChangeText={setTitle}
                maxLength={200}
                accessibilityLabel="Reflection title"
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).springify()}>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {REFLECTION_CHIP_OPTIONS.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    className={`rounded-lg px-3 py-2 border ${
                      reflectionType === t.key
                        ? 'bg-primary border-teal-500'
                        : 'bg-gray-200 border-[#007AFF]/15'
                    }`}
                    onPress={() => setReflectionType(t.key)}
                    accessibilityLabel={`Category ${t.label}`}
                    accessibilityRole="button"
                  >
                    <Text
                      className={reflectionType === t.key ? 'text-white' : 'text-gray-900'}
                      style={{ fontFamily: clinicalTokens.fonts.body }}
                    >
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(250).springify()}>
              <TextInput
                className="bg-white text-[#000000] rounded-xl px-4 py-3 mb-1 border border-[#007AFF]/15"
                placeholder="What did you learn from this experience?"
                placeholderTextColor="#666666"
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={10000}
                accessibilityLabel="Reflection body"
              />
              <Text className="text-[#8E8E93] text-xs mb-3" style={{ fontFamily: clinicalTokens.fonts.body }}>
                {countWords(body)} {countWords(body) === 1 ? 'word' : 'words'}
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(300).springify()}>
              <View className="flex-row items-center justify-between bg-white rounded-xl px-4 py-3 mb-3 border border-[#007AFF]/15">
                <Text className="text-[#3C3C43] text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>
                  Share with program leadership
                </Text>
                <Switch
                  value={shared}
                  onValueChange={setShared}
                  accessibilityLabel="Share reflection with program leadership"
                />
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(350).springify()}>
              <TouchableOpacity
                className="bg-primary rounded-xl py-3 mb-5 items-center"
                onPress={handleSave}
                disabled={saving || loading}
                accessibilityRole="button"
                accessibilityLabel="Save reflection"
              >
                <Text className="text-white text-base" style={{ fontFamily: clinicalTokens.fonts.heading }}>
                  {saving ? 'Saving…' : 'Save Reflection'}
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {loading && (
              <View className="py-4 items-center">
                <Text className="text-[#8E8E93] text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>
                  Loading…
                </Text>
              </View>
            )}
            {!loading && error && (
              <View className="py-3">
                <Text className="text-[#FF3B30] text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>
                  {error}
                </Text>
              </View>
            )}
            <View className="pb-6">
              <Text
                className="text-[#000000] text-base font-semibold mb-2"
                style={{ fontFamily: clinicalTokens.fonts.heading }}
                accessibilityRole="header"
              >
                My Reflections
              </Text>
            </View>
          </>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <View className="bg-white rounded-2xl p-5 border border-border/50">
              <Text className="text-[#3C3C43] text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>
                No reflections yet. Write your first one above — regular structured reflection is a core
                portfolio habit.
              </Text>
            </View>
          ) : null
        }
      />
    </ScreenWrapper>
  );
}
