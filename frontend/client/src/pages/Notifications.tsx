import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { mockNotifications } from "@/lib/mock-data";
import type { Notification } from "@/lib/types";
import {
  Bell,
  BellOff,
  CheckCheck,
  AlertTriangle,
  Info,
  Search,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const typeConfig: Record<string, { icon: typeof AlertTriangle; className: string }> = {
  findings: { icon: Search, className: "text-cyan-400 bg-cyan-500/10" },
  error: { icon: AlertTriangle, className: "text-red-400 bg-red-500/10" },
  info: { icon: Info, className: "text-blue-400 bg-blue-500/10" },
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <div className="space-y-4 max-w-[700px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={markAllRead}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark All Read
          </Button>
        )}
      </div>

      {/* Notification List */}
      {notifications.length === 0 ? (
        <Card className="bg-card border-card-border">
          <CardContent className="flex flex-col items-center py-12">
            <BellOff className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => {
            const config = typeConfig[notification.type];
            const Icon = config.icon;
            return (
              <Card
                key={notification.id}
                className={`bg-card border-card-border transition-colors cursor-pointer ${
                  !notification.read ? "border-l-2 border-l-primary" : ""
                }`}
                onClick={() => markAsRead(notification.id)}
                data-testid={`card-notification-${notification.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${config.className}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={`text-sm ${!notification.read ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
                            {notification.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{notification.message}</p>
                        </div>
                        <span className="text-[11px] text-muted-foreground flex-shrink-0">
                          {formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true })}
                        </span>
                      </div>
                      {notification.task_id && (
                        <Link href={`/tasks/${notification.task_id}/results`}>
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] text-primary hover:text-primary/80 mt-1.5 -ml-2 gap-1">
                            View Results <ChevronRight className="w-3 h-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                    {!notification.read && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
