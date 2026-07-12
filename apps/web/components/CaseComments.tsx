'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

interface Comment {
  id: string;
  case_entry_id: string;
  parent_id: string | null;
  author_id: string;
  content: string;
  created_at: string;
  author_name?: string;
  replies?: Comment[];
}

interface CaseCommentsProps {
  caseEntryId: string;
  tenantId: string;
  currentUserId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function CaseComments({
  caseEntryId,
  tenantId: _tenantId,
  currentUserId,
  isOpen,
  onClose,
}: CaseCommentsProps) {
  const supabase = createClient();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch comments
  useEffect(() => {
    if (!isOpen || !caseEntryId) return;

    async function fetchComments() {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('case_comments')
        .select(
          'id, case_entry_id, parent_id, author_id, content, created_at, profiles!author_id(full_name)'
        )
        .eq('case_entry_id', caseEntryId)
        .order('created_at', { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      // Build threaded structure
      const allComments = ((data ?? []) as unknown as Comment[]).map(
        (c: Comment & { profiles?: { full_name: string } | { full_name: string }[] }) => {
          const profile = Array.isArray(c.profiles)
            ? c.profiles[0]
            : (c.profiles as { full_name: string } | undefined);
          return {
            ...c,
            author_name: profile?.full_name ?? 'Unknown',
          };
        }
      );

      // Build thread tree
      const topLevel: Comment[] = [];
      const repliesMap = new Map<string, Comment[]>();

      for (const c of allComments) {
        if (!c.parent_id) {
          topLevel.push(c);
        } else {
          if (!repliesMap.has(c.parent_id)) {
            repliesMap.set(c.parent_id, []);
          }
          repliesMap.get(c.parent_id)!.push(c);
        }
      }

      // Attach replies to parent comments
      for (const comment of allComments) {
        comment.replies = repliesMap.get(comment.id) || [];
      }

      setComments(topLevel);
      setLoading(false);
    }

    fetchComments();
  }, [isOpen, caseEntryId, supabase]);

  // Realtime subscription for new comments
  useEffect(() => {
    if (!isOpen || !caseEntryId) return;

    const channel = supabase
      .channel(`case-comments-${caseEntryId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'case_comments',
          filter: `case_entry_id=eq.${caseEntryId}`,
        },
        async (payload: { new: Record<string, unknown> }) => {
          const newC = payload.new as Comment;
          // Fetch the author name
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', newC.author_id)
            .single();

          const commentWithAuthor: Comment = {
            ...newC,
            author_name: (profile as { full_name: string } | null)?.full_name ?? 'Unknown',
            replies: [],
          };

          setComments((prev) => {
            if (commentWithAuthor.parent_id) {
              // Add as reply
              return prev.map((c) => {
                if (c.id === commentWithAuthor.parent_id) {
                  return {
                    ...c,
                    replies: [...(c.replies || []), commentWithAuthor],
                  };
                }
                return c;
              });
            }
            return [...prev, commentWithAuthor];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, caseEntryId, supabase]);

  // Scroll to bottom on new comments
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  async function handleSubmitComment() {
    if (!newComment.trim()) return;
    setSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase
      .from('case_comments')
      .insert({
        case_entry_id: caseEntryId,
        author_id: currentUserId,
        content: newComment.trim(),
        parent_id: null,
      });

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setNewComment('');
  }

  async function handleSubmitReply(parentId: string) {
    if (!replyContent.trim()) return;
    setSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase
      .from('case_comments')
      .insert({
        case_entry_id: caseEntryId,
        author_id: currentUserId,
        content: replyContent.trim(),
        parent_id: parentId,
      });

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setReplyContent('');
    setReplyTo(null);
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-lg glass-panel p-0 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary">
                Comments
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 hover:bg-neutral-dark transition-colors"
                aria-label="Close"
              >
                <svg
                  className="w-5 h-5 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {error && <ErrorDisplay message={error} />}

            {/* Comments list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse space-y-2">
                      <div className="h-4 w-24 rounded bg-default-200" />
                      <div className="h-3 w-full rounded bg-default-200" />
                      <div className="h-3 w-3/4 rounded bg-default-200" />
                    </div>
                  ))}
                </div>
              ) : comments.length === 0 ? (
                <div className="text-center py-8">
                  <svg
                    className="w-10 h-10 mx-auto mb-3 text-text-muted/50"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  <p className="text-sm text-text-muted">No comments yet</p>
                  <p className="text-xs text-text-muted mt-1">
                    Start the discussion by adding a comment.
                  </p>
                </div>
              ) : (
                comments.map((comment) => (
                  <div key={comment.id}>
                    {/* Parent comment */}
                    <CommentCard
                      comment={comment}
                      currentUserId={currentUserId}
                      formatDate={formatDate}
                      onReply={() => {
                        setReplyTo(comment.id);
                        setTimeout(() => {
                          replyInputRef.current?.focus();
                        }, 100);
                      }}
                    />

                    {/* Replies */}
                    {comment.replies && comment.replies.length > 0 && (
                      <div className="ml-6 mt-2 space-y-2 pl-4 border-l-2 border-border">
                        {comment.replies.map((reply) => (
                          <CommentCard
                            key={reply.id}
                            comment={reply}
                            currentUserId={currentUserId}
                            formatDate={formatDate}
                            isReply
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={commentsEndRef} />
            </div>

            {/* Reply form */}
            {replyTo && (
              <div className="px-6 py-3 border-t border-border bg-neutral-dark/30">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-text-muted">
                    Replying to comment
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyTo(null);
                      setReplyContent('');
                    }}
                    className="text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <div className="flex gap-2">
                  <textarea
                    ref={replyInputRef}
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Write a reply..."
                    rows={2}
                    className="flex-1 rounded-xl bg-surface-solid border border-border p-2.5 text-sm resize-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSubmitReply(replyTo)}
                    disabled={submitting || !replyContent.trim()}
                    className="self-end rounded-full bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Reply
                  </button>
                </div>
              </div>
            )}

            {/* Add comment form */}
            {!replyTo && (
              <div className="px-6 py-4 border-t border-border">
                <div className="flex gap-2">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    rows={2}
                    className="flex-1 rounded-xl bg-neutral-dark border border-border p-3 text-sm resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmitComment();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSubmitComment}
                    disabled={submitting || !newComment.trim()}
                    className="self-end rounded-full bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Internal comment card component
function CommentCard({
  comment,
  currentUserId,
  formatDate,
  onReply,
  isReply,
}: {
  comment: Comment;
  currentUserId: string;
  formatDate: (d: string) => string;
  onReply?: () => void;
  isReply?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-1"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
          {comment.author_name?.charAt(0).toUpperCase() || '?'}
        </span>
        <span className="text-sm font-medium text-text-primary">
          {comment.author_name}
        </span>
        <span className="text-xs text-text-muted">
          {formatDate(comment.created_at)}
        </span>
        {comment.author_id === currentUserId && (
          <span className="inline-flex items-center bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-medium">
            You
          </span>
        )}
      </div>
      <p className="text-sm text-text-secondary ml-8">{comment.content}</p>
      {!isReply && onReply && (
        <button
          type="button"
          onClick={onReply}
          className="ml-8 text-xs text-text-muted hover:text-primary transition-colors"
        >
          Reply
        </button>
      )}
    </motion.div>
  );
}
