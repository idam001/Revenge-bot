import { db, ensureDbSchema } from "@/db";
import {
  conversations,
  memories,
  messages,
  providerKeys,
  type AttachmentItem,
} from "@/db/schema";
import {
  streamRevengeCompletion,
  type ChatTurnMessage,
  type SavedProviderConfig,
} from "@/lib/revenge-engine";
import { gatherWebGrounding } from "@/lib/web-grounding";
import { getOwner } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { and, asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGES_PER_TURN = 4;
const MAX_IMAGE_DATA_URL_CHARS = 6_000_000; // ~4.5 MB image

function isUsableImage(content: string | undefined): content is string {
  return (
    typeof content === "string" &&
    /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(content.slice(0, 64) + "A") &&
    content.length > 100 &&
    content.length <= MAX_IMAGE_DATA_URL_CHARS
  );
}

/**
 * Keep pixel data only on the two most recent image-bearing user turns
 * (so follow-up questions about a photo still work), and replace older
 * images with a short note to keep requests small and fast.
 */
function keepRecentImages(history: ChatTurnMessage[]): ChatTurnMessage[] {
  let kept = 0;
  const out = [...history];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (!m.images?.length) continue;
    if (kept < 2 && out.length - i <= 10) {
      kept++;
      continue;
    }
    out[i] = {
      role: m.role,
      content: `${m.content}\n[The user shared ${m.images.length} image(s) earlier in this chat]`,
    };
  }
  return out;
}

function generateSmartTitle(rawPrompt: string): string {
  const cleaned = rawPrompt
    .replace(/^\/\w+\s*/i, "")
    .replace(/[#*`_~>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Revenge Neural Session";
  return cleaned.length > 54 ? `${cleaned.slice(0, 54).trim()}…` : cleaned;
}

export async function POST(req: Request) {
  try {
    await ensureDbSchema();

    // Identity is resolved server-side; the client cannot claim another owner.
    const owner = await getOwner({ create: true, request: req });
    if (!owner) {
      return Response.json({ error: "Session unavailable", code: "NO_SESSION" }, { status: 401 });
    }
    const rl = rateLimit(`chat:${owner.key}:${clientKey(req)}`, 40, 60_000);
    if (!rl.ok) {
      return Response.json(
        { error: "Rate limit reached — wait a moment and try again.", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = (await req.json()) as {
      conversationId?: string | null;
      message: string;
      attachments?: AttachmentItem[];
      modelId?: string;
      personaId?: string;
      enableWebSearch?: boolean;
      forceImageGen?: boolean;
      forceVideoGen?: boolean;
      reasoningEffort?: string;
      temperature?: number;
      maxTokens?: number;
      customSystemPrompt?: string;
      autoFailover?: boolean;
      skipSaveUserMessage?: boolean;
      appendToAssistantId?: string | null;
      ephemeral?: boolean;
      ephemeralHistory?: ChatTurnMessage[];
    };

    const userText = (body.message ?? "").trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    if (!userText && attachments.length === 0) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const modelId = body.modelId || "revenge-omega-x";
    const personaId = body.personaId || "unchained";
    const isEphemeral = Boolean(body.ephemeral);

    // Load provider keys & enabled memories in parallel
    const [keyRows, memoryRows] = await Promise.all([
      db.select().from(providerKeys),
      db
        .select()
        .from(memories)
        .where(and(eq(memories.enabled, true), eq(memories.ownerKey, owner.key))),
    ]);

    const savedKeysMap: Record<string, SavedProviderConfig> = {};
    for (const row of keyRows) {
      savedKeysMap[row.providerId] = {
        providerId: row.providerId,
        apiKey: row.apiKey,
        baseUrl: row.baseUrl,
        customModelId: row.customModelId,
        enabled: row.enabled,
      };
    }

    let memoriesBlock =
      memoryRows.length > 0
        ? memoryRows.map((m, i) => `${i + 1}. [${m.category}] ${m.content}`).join("\n")
        : "";

    let activeConvId = body.conversationId || null;
    let newlyCreatedConv: typeof conversations.$inferSelect | null = null;
    let historyMessages: ChatTurnMessage[] = [];
    let savedUserMsgId: string | null = null;

    // REVENGE VISION: real images go to vision models as image data, text files go inline
    const imageAttachments = attachments.filter((a) => isUsableImage(a.content)).slice(0, MAX_IMAGES_PER_TURN);
    const textAttachments = attachments.filter((a) => !a.content.startsWith("data:image/"));
    const currentImages = imageAttachments.map((a) => a.content);

    let augmentedUserPrompt =
      userText ||
      (currentImages.length > 0
        ? "Analyze the attached image(s) in detail. Describe what you see and transcribe any visible text."
        : "Analyze the attached files thoroughly.");
    if (textAttachments.length > 0) {
      const fileSections = textAttachments
        .map(
          (att) =>
            `\n--- ATTACHED FILE: ${att.name} (${att.type}) ---\n${att.content.slice(
              0,
              24000
            )}\n--- END FILE: ${att.name} ---`
        )
        .join("\n");
      augmentedUserPrompt = `${augmentedUserPrompt}\n${fileSections}`;
    }

    if (isEphemeral) {
      historyMessages = [
        ...(body.ephemeralHistory ?? []),
        {
          role: "user",
          content: augmentedUserPrompt,
          ...(currentImages.length > 0 ? { images: currentImages } : {}),
        },
      ];
    } else {
      if (!activeConvId) {
        const [created] = await db
          .insert(conversations)
          .values({
            ownerKey: owner.key,
            title: generateSmartTitle(
              userText || (currentImages.length > 0 ? "Image analysis" : attachments[0]?.name || "File Analysis")
            ),
            modelId,
            personaId,
          })
          .returning();
        activeConvId = created.id;
        newlyCreatedConv = created;
      } else {
        const [existingConv] = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.id, activeConvId), eq(conversations.ownerKey, owner.key)));

        if (!existingConv) {
          const [created] = await db
            .insert(conversations)
            .values({
              ownerKey: owner.key,
              title: generateSmartTitle(userText),
              modelId,
              personaId,
            })
            .returning();
          activeConvId = created.id;
          newlyCreatedConv = created;
        } else {
          const prevMsgs = await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, activeConvId))
            .orderBy(asc(messages.createdAt));

          if (
            prevMsgs.length === 0 &&
            existingConv.title === "New Revenge Session"
          ) {
            const newTitle = generateSmartTitle(userText);
            const [updatedConv] = await db
              .update(conversations)
              .set({ title: newTitle, modelId, personaId, updatedAt: new Date() })
              .where(and(eq(conversations.id, activeConvId), eq(conversations.ownerKey, owner.key)))
              .returning();
            newlyCreatedConv = updatedConv;
          } else {
            await db
              .update(conversations)
              .set({ modelId, personaId, updatedAt: new Date() })
              .where(and(eq(conversations.id, activeConvId), eq(conversations.ownerKey, owner.key)));
          }

          historyMessages = prevMsgs.map((m) => {
            const role: ChatTurnMessage["role"] =
              m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
            const pastImages =
              role === "user"
                ? (m.attachments ?? [])
                    .filter((a) => isUsableImage(a.content))
                    .map((a) => a.content)
                    .slice(0, MAX_IMAGES_PER_TURN)
                : [];
            return pastImages.length > 0
              ? { role, content: m.content, images: pastImages }
              : { role, content: m.content };
          });
          historyMessages = keepRecentImages(historyMessages);
        }
      }

      if (!body.skipSaveUserMessage && activeConvId) {
        const [insertedUser] = await db
          .insert(messages)
          .values({
            ownerKey: owner.key,
            conversationId: activeConvId,
            role: "user",
            content:
              userText ||
              (currentImages.length > 0
                ? `📷 ${currentImages.length} image${currentImages.length > 1 ? "s" : ""}`
                : `Attached: ${attachments.map((a) => a.name).join(", ")}`),
            attachments: attachments.length > 0 ? [...textAttachments, ...imageAttachments] : null,
          })
          .returning();
        savedUserMsgId = insertedUser.id;
      }

      historyMessages.push({
        role: "user",
        content: augmentedUserPrompt,
        ...(currentImages.length > 0 ? { images: currentImages } : {}),
      });
      historyMessages = keepRecentImages(historyMessages);

      // Model-switch continuity: a different engine now continues this thread.
      // Hand the full history (already loaded above) plus an explicit handoff
      // so the new model never restarts or forgets earlier turns.
      if (!isEphemeral && activeConvId) {
        try {
          const allPrev = await db
            .select({ role: messages.role, modelId: messages.modelId })
            .from(messages)
            .where(eq(messages.conversationId, activeConvId))
            .orderBy(asc(messages.createdAt));
          const lastAssistant = [...allPrev]
            .reverse()
            .find((m) => m.role === "assistant" && m.modelId);
          if (lastAssistant?.modelId && lastAssistant.modelId !== modelId) {
            memoriesBlock +=
              `\n[MODEL HANDOFF: earlier turns in this thread were answered by '${lastAssistant.modelId}'. ` +
              `You are '${modelId}'. Continue the SAME conversation with full context — do not restart, ` +
              `do not re-ask for anything already discussed, and keep the same language, tone and task.]`;
          }
        } catch {
          // Handoff note is best-effort; history itself is already complete.
        }
      }
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        };

        try {
          if (newlyCreatedConv) {
            send({ type: "conversation", conversation: newlyCreatedConv });
          }

          // Live web grounding: manual toggle + auto intent detection + always-on search model
          const { getModelById } = await import("@/lib/revenge-registry");
          const { detectWebSearchIntent } = await import("@/lib/web-grounding");
          const activeModelDef = getModelById(modelId);
          const isMediaGen =
            (currentImages.length === 0 &&
              (Boolean(activeModelDef.supportsVideoGen) ||
                Boolean(activeModelDef.supportsImageGen))) ||
            Boolean(body.forceVideoGen) ||
            Boolean(body.forceImageGen) ||
            /^\/(video|imagine)\b/i.test(userText.trim());

          const willSearch =
            !isMediaGen &&
            (Boolean(body.enableWebSearch) ||
              Boolean(activeModelDef.forceWebSearch) ||
              detectWebSearchIntent(userText) ||
              /https?:\/\//i.test(userText));

          if (willSearch) {
            send({ type: "searching", query: userText.slice(0, 120) });
          }

          const { sources, contextBlock } = isMediaGen
            ? { sources: [], contextBlock: "" }
            : await gatherWebGrounding(
                userText,
                Boolean(body.enableWebSearch),
                { forceSearch: Boolean(activeModelDef.forceWebSearch) }
              );

          if (sources.length > 0) {
            send({ type: "sources", sources });
          } else if (willSearch) {
            send({ type: "search_empty" });
          }

          const result = await streamRevengeCompletion({
            modelId,
            personaId,
            messages: historyMessages,
            conversationId: activeConvId,
            customSystemPrompt: body.customSystemPrompt,
            memoriesBlock,
            webContextBlock: contextBlock,
            temperature: body.temperature ?? 0.7,
            maxTokens: body.maxTokens ?? 8192,
            reasoningEffort: body.reasoningEffort ?? "high",
            autoFailover: body.autoFailover ?? true,
            forceImageGen: Boolean(body.forceImageGen),
            forceVideoGen: Boolean(body.forceVideoGen),
            savedKeysMap,
            onEvent: (evt) => {
              send(evt as unknown as Record<string, unknown>);
            },
          });

          if (!isEphemeral && activeConvId) {
            let savedAssistant: typeof messages.$inferSelect | undefined;

            if (body.appendToAssistantId) {
              const [existingMsg] = await db
                .select()
                .from(messages)
                .where(eq(messages.id, body.appendToAssistantId));
              if (existingMsg) {
                const [updatedMsg] = await db
                  .update(messages)
                  .set({
                    content: existingMsg.content + result.content,
                    providerUsed: result.providerUsed,
                    latencyMs: (existingMsg.latencyMs ?? 0) + result.latencyMs,
                    tokensPerSec: result.tokensPerSec,
                  })
                  .where(eq(messages.id, body.appendToAssistantId))
                  .returning();
                savedAssistant = updatedMsg;
              }
            }

            if (!savedAssistant) {
              const [inserted] = await db
                .insert(messages)
                .values({
                  ownerKey: owner.key,
                  conversationId: activeConvId,
                  role: "assistant",
                  content: result.content,
                  reasoning: result.reasoning || null,
                  reasoningMs: result.reasoningMs || null,
                  modelId,
                  providerUsed: result.providerUsed,
                  latencyMs: result.latencyMs,
                  tokensPerSec: result.tokensPerSec,
                  webSources: sources.length > 0 ? sources : null,
                  imageUrl: result.imageUrl || null,
                  videoUrl: result.videoUrl || null,
                })
                .returning();
              savedAssistant = inserted;
            }

            send({
              type: "saved",
              conversationId: activeConvId,
              userMessageId: savedUserMsgId,
              assistantMessage: savedAssistant,
            });
          }
        } catch (err) {
          const errMsg =
            err instanceof Error ? err.message : "Inference pipeline error";
          send({ type: "error", error: errMsg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat API error";
    return Response.json({ error: message }, { status: 500 });
  }
}
