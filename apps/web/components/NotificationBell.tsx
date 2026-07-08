'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
  data?: Record<string, unknown> | null;
}

interface NotificationBellProps {
  userId: string;
  tenantId: string;
}

export default function NotificationBell({
  userId,
  tenantId,
}: NotificationBellProps) {
  const supabase = createClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch initial notifications
  useEffect(() => {
    async function fetchNotifications() {
      const { data } = await supabase
        .from('notifications')
        .select('id, title, body, read, created_at, data')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (data) {
        const typed = data as Notification[];
        setNotifications(typed);
        setUnreadCount(typed.filter((n) => !n.read).length);
      }
    }
    fetchNotifications();
  }, [userId, tenantId, supabase]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((prev) => prev + 1);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const updated = payload.new as Notification;
          setNotifications((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n))
          );
          // Recalculate unread count
          setNotifications((prev) => {
            setUnreadCount(prev.filter((n) => !n.read).length);
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, supabase]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function markAsRead(notificationId: string) {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);
  }

  async function markAllAsRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
    setUnreadCount(0);
  }

  function timeAgo(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  return (
    <div ref={dropdownRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-full p-2 hover:bg-neutral-dark transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <svg
          className="w-5 h-5 text-text-secondary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4.5 h-4.5 rounded-full bg-rejected text-white text-[10px] font-bold leading-none min-w-[18px] min-h-[18px]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-80 sm:w-96 bg-surface-solid border border-border rounded-2xl shadow-lg overflow-hidden z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-text-muted">
                  <svg
                    className="w-8 h-8 mx-auto mb-2 text-text-muted/50"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                    />
                  </svg>
                  No notifications yet
                </div>
              ) : (
                notifications.map((notif) => (
                  <button
                    key={notif.id}
                    type="button"
                    onClick={() => markAsRead(notif.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-neutral-dark transition-colors ${
                      !notif.read ? 'bg-primary-glow' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                          !notif.read ? 'bg-primary' : 'bg-transparent'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm ${
                            !notif.read
                              ? 'font-semibold text-text-primary'
                              : 'text-text-secondary'
                          }`}
                        >
                          {notif.title}
                        </p>
                        {notif.body && (
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                            {notif.body}
                          </p>
                        )}
                        <p className="text-[10px] text-text-muted mt-1">
                          {timeAgo(notif.created_at)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
