"use client";
import { Check, CheckCheck, Clock, CornerUpLeft, Forward, Image as ImageIcon, MoreVertical, Paperclip, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { ChatMessage } from "@/hooks/useChat";
import { DocumentCard, ImageGallery, isImage, type Attachment } from "./attachments";

/** hh:mm under every bubble - the timestamp WhatsApp shows. */
export const clockTime = (d: string) => new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * Delivery ticks (A72), shown on your own messages only:
 *   clock  - still being sent
 *   single - saved by the server
 *   double - the recipient's browser has it
 *   blue   - they have opened the conversation
 * In a group, two ticks mean *everyone* has it, matching WhatsApp.
 */
export function Ticks({ message, recipientIds, className }: { message: ChatMessage; recipientIds: string[]; className?: string }) {
  if (message.failed) return <TriangleAlert className={cn("size-3.5 text-danger", className)} aria-label="Not sent" />;
  if (message.pending) return <Clock className={cn("size-3.5 opacity-60", className)} aria-label="Sending" />;
  const others = recipientIds.filter((id) => id !== message.senderId);
  const reached = (list: { userId: string }[]) => others.length > 0 && others.every((id) => list.some((r) => r.userId === id));
  if (reached(message.readBy)) return <CheckCheck className={cn("size-3.5 text-info", className)} aria-label="Read" />;
  if (reached(message.deliveredTo)) return <CheckCheck className={cn("size-3.5 opacity-60", className)} aria-label="Delivered" />;
  return <Check className={cn("size-3.5 opacity-60", className)} aria-label="Sent" />;
}

function renderBody(body: string, mentionNames: Set<string>) {
  return body.split(/(@[\w][\w .'-]*?(?=\s@|[,.!?:;]|\s{2}|$))/g).map((part, i) =>
    part.startsWith("@") && mentionNames.has(part.slice(1).trim())
      ? <span key={i} className="rounded bg-info-soft px-1 font-medium text-info">{part}</span>
      : <span key={i}>{part}</span>);
}

interface Props {
  message: ChatMessage;
  mine: boolean;
  /** First of a run from the same person: shows the avatar and the name. */
  head: boolean;
  /** Last of a run: the bubble gets the tail. */
  tail: boolean;
  showName: boolean;
  recipientIds: string[];
  mentionNames: Set<string>;
  readOnly?: boolean;
  onReply: (m: ChatMessage) => void;
  onForward: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onOpenImage: (images: Attachment[], index: number) => void;
}

export function MessageBubble({ message: m, mine, head, tail, showName, recipientIds, mentionNames, readOnly, onReply, onForward, onEdit, onDelete, onOpenImage }: Props) {
  const images = m.attachments.filter(isImage);
  const docs = m.attachments.filter((a) => !isImage(a));
  const textOnly = m.attachments.length === 0 && !m.deleted;

  return (
    <div className={cn("group flex items-end gap-1.5", mine ? "flex-row-reverse" : "flex-row", head ? "mt-2.5" : "mt-0.5")} data-message-id={m.id}>
      {!mine && <div className="w-7 shrink-0">{head && m.sender && <Avatar name={m.sender.name} src={m.sender.avatarUrl} size="sm" />}</div>}
      {/* `relative` so the hover actions can sit beside the bubble instead of taking a row of their
          own - in flow they pushed the avatar away from the bubble and cluttered phones. */}
      <div className={cn("relative flex max-w-[min(30rem,78%)] min-w-0 flex-col", mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "relative min-w-0 px-2 py-1.5 text-sm shadow-[0_1px_1px_rgb(42_38_32/0.08)]",
            mine ? "bg-primary-soft text-foreground" : "bg-card text-foreground ring-1 ring-border/50",
            // Square off the corner that carries the tail, round everything else.
            "rounded-2xl", tail && (mine ? "rounded-br-sm" : "rounded-bl-sm"),
            m.deleted && "italic text-muted-foreground", m.pending && "opacity-70", m.failed && "ring-2 ring-danger",
          )}
        >
          {showName && !mine && <p className="mb-0.5 text-[12px] font-semibold text-primary">{m.sender?.name}</p>}
          {m.forwarded && !m.deleted && <p className="mb-0.5 flex items-center gap-1 text-[11px] italic text-muted-foreground"><Forward className="size-3" />Forwarded</p>}
          {m.replyTo && (
            <div className={cn("mb-1 flex gap-1.5 rounded-lg border-l-2 border-info bg-foreground/5 px-2 py-1 text-xs")}>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-info">{m.replyTo.sender}</span>
                <span className="block truncate opacity-80">{m.replyTo.body || (m.replyTo.attachmentCount > 0 ? `${m.replyTo.attachmentCount} attachment${m.replyTo.attachmentCount === 1 ? "" : "s"}` : "")}</span>
              </span>
              {m.replyTo.attachmentCount > 0 && <ImageIcon className="size-3.5 shrink-0 self-center opacity-60" />}
            </div>
          )}
          {(images.length > 0 || docs.length > 0) && (
            <div className="mb-1 space-y-1">
              {images.length > 0 && <ImageGallery images={images} onOpen={(i) => onOpenImage(images, i)} />}
              {docs.map((d) => <DocumentCard key={d.id} file={d} mine={mine} />)}
            </div>
          )}
          {m.deleted ? <span className="pr-1">This message was deleted</span> : m.body && <span className="whitespace-pre-wrap break-words">{renderBody(m.body, mentionNames)}</span>}
          {/* The timestamp floats at the end of the last line, WhatsApp-style, and reserves space so text never runs under it. */}
          <span className={cn("float-right ml-2 flex translate-y-1 items-center gap-1 text-[10px] leading-none text-muted-foreground", textOnly ? "mt-0" : "mt-0.5")}>
            {m.editedAt && !m.deleted && <span className="italic">edited</span>}
            <span title={formatDateTime(m.createdAt)}>{clockTime(m.createdAt)}</span>
            {mine && !m.deleted && <Ticks message={m} recipientIds={recipientIds} />}
          </span>
          <span className="clear-both block" />
        </div>
        {!m.deleted && !readOnly && (
          <div className={cn("absolute top-0.5 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-45", mine ? "right-full mr-0.5 flex-row-reverse" : "left-full ml-0.5")}>
            <button className="rounded-md p-1 text-muted-foreground hover:bg-muted" title="Reply" aria-label="Reply" onClick={() => onReply(m)}><CornerUpLeft className="size-3.5" /></button>
            {!mine && <button className="rounded-md p-1 text-muted-foreground hover:bg-muted" title="Forward" aria-label="Forward" onClick={() => onForward(m)}><Forward className="size-3.5" /></button>}
            {mine && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="rounded-md p-1 text-muted-foreground hover:bg-muted" title="More" aria-label="Message actions"><MoreVertical className="size-3.5" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align={mine ? "end" : "start"}>
                  <DropdownMenuItem onClick={() => onForward(m)}><Forward className="size-4" />Forward</DropdownMenuItem>
                  {m.attachments.length === 0 && <DropdownMenuItem onClick={() => onEdit(m)}><Pencil className="size-4" />Edit</DropdownMenuItem>}
                  {m.attachments.length > 0 && <DropdownMenuItem asChild><a href={m.attachments[0].downloadUrl} download><Paperclip className="size-4" />Download attachment</a></DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => onDelete(m)} className="text-danger"><Trash2 className="size-4" />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
