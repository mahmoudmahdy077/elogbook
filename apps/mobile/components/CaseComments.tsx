/**
 * Case comments on mobile — read the thread and add a note.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens, type UserRole } from '@elogbook/shared';
import {
  addCaseComment,
  deleteCaseComment,
  listCaseComments,
  type CaseComment,
} from '../lib/comments-store';

interface Props {
  caseId: string;
  tenantId: string;
  profileId: string;
  role: UserRole | null;
}

export function CaseComments({ caseId, tenantId, profileId, role }: Props) {
  const [comments, setComments] = useState<CaseComment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await listCaseComments(caseId);
    setComments(result.comments);
    setError(result.error);
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    const result = await addCaseComment({
      entryId: caseId,
      tenantId,
      authorId: profileId,
      body: draft,
    });
    setSending(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not post the comment.');
      return;
    }
    setDraft('');
    await load();
  };

  const remove = (comment: CaseComment) => {
    Alert.alert('Delete comment?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const result = await deleteCaseComment(comment.id);
          if (!result.ok) {
            setError(result.error ?? 'Could not delete.');
            return;
          }
          setComments((prev) => prev.filter((c) => c.id !== comment.id));
        },
      },
    ]);
  };

  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(0,122,255,0.15)',
        padding: 14,
        marginBottom: 14,
      }}
    >
      <Text
        style={{
          fontFamily: clinicalTokens.fonts.heading,
          fontWeight: '600',
          fontSize: 15,
          color: clinicalTokens.colors.text.primary,
          marginBottom: 8,
        }}
      >
        Comments
      </Text>

      {loading ? (
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} />
      ) : comments.length === 0 ? (
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 13,
            color: clinicalTokens.colors.text.muted,
            marginBottom: 8,
          }}
        >
          No comments yet.
        </Text>
      ) : (
        comments.map((comment) => (
          <View
            key={comment.id}
            style={{
              borderTopWidth: 1,
              borderTopColor: 'rgba(0,0,0,0.06)',
              paddingTop: 8,
              marginTop: 8,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: clinicalTokens.fonts.heading,
                  fontSize: 13,
                  fontWeight: '600',
                  color: clinicalTokens.colors.text.primary,
                }}
              >
                {comment.author_name}
                <Text
                  style={{
                    fontFamily: clinicalTokens.fonts.body,
                    fontWeight: '400',
                    color: clinicalTokens.colors.text.muted,
                  }}
                >
                  {'  '}
                  {new Date(comment.created_at).toLocaleDateString()}
                </Text>
              </Text>
              <Text
                style={{
                  marginTop: 2,
                  fontFamily: clinicalTokens.fonts.body,
                  fontSize: 14,
                  lineHeight: 20,
                  color: clinicalTokens.colors.text.secondary,
                }}
              >
                {comment.body}
              </Text>
            </View>
            {(comment.author_id === profileId ||
              ['supervisor', 'director', 'institution_admin', 'admin'].includes(role ?? '')) && (
              <TouchableOpacity
                onPress={() => remove(comment)}
                accessibilityLabel="Delete comment"
                accessibilityRole="button"
                style={{ padding: 4 }}
              >
                <Ionicons name="trash-outline" size={16} color={clinicalTokens.colors.text.muted} />
              </TouchableOpacity>
            )}
          </View>
        ))
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
        <TextInput
          value={draft}
          onChangeText={(v) => setDraft(v.slice(0, 2000))}
          placeholder="Add a comment…"
          placeholderTextColor={clinicalTokens.colors.text.muted}
          multiline
          accessibilityLabel="Comment"
          style={{
            flex: 1,
            minHeight: 42,
            maxHeight: 120,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(0,0,0,0.12)',
            paddingHorizontal: 12,
            paddingVertical: 9,
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 14,
            color: clinicalTokens.colors.text.primary,
          }}
        />
        <TouchableOpacity
          onPress={send}
          disabled={sending || !draft.trim()}
          accessibilityLabel="Post comment"
          accessibilityRole="button"
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: clinicalTokens.colors.primary.DEFAULT,
            opacity: sending || !draft.trim() ? 0.5 : 1,
          }}
        >
          {sending ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>

      {error && (
        <Text
          accessibilityRole="alert"
          style={{
            marginTop: 6,
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 12,
            color: clinicalTokens.colors.status.text.danger,
          }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}

export default CaseComments;
