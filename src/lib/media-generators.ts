import { saveMediaBuffer } from "./media-store";

export type VideoBackendId =
  | "ltx-video-13b"
  | "ltx-zerogpu-pro"
  | "animatediff-lightning";

export type ImageBackendId =
  | "ovh-sdxl"
  | "bfl-flux-schnell"
  | "nvidia-sana"
  | "pollinations-flux"
  | "aihorde-sd";

export interface GeneratedMediaResult {
  url: string;
  providerUsed: string;
  seed: number;
  resolution: string;
}

function parseGradioCompletePayload(rawSse: string): unknown {
  const blocks = rawSse.split(/\r?\n\r?\n/).filter(Boolean);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const evt = block.match(/^event:\s*(\S+)/m)?.[1];
    const dataLine = block.match(/^data:\s*(.+)$/m)?.[1];
    if (evt === "error") {
      throw new Error(`Gradio Space error: ${dataLine || "queue busy"}`);
    }
    if (evt === "complete" && dataLine) {
      return JSON.parse(dataLine);
    }
  }
  throw new Error("Gradio Space closed stream before completing");
}

async function cacheRemoteBinary(
  remoteUrl: string,
  ext: "mp4" | "webp" | "jpg" | "png",
  timeoutMs = 25000,
  headers?: Record<string, string>
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(remoteUrl, { headers, signal: ac.signal });
    if (!res.ok) {
      throw new Error(`Media download HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 1024) {
      throw new Error("Downloaded media buffer too small");
    }
    return await saveMediaBuffer(Buffer.from(ab), ext);
  } finally {
    clearTimeout(timer);
  }
}

/* ===================================================================== *
 *  FREE KEYLESS VIDEO GENERATORS (3 INDEPENDENT ENGINES + FAILOVER)
 * ===================================================================== */

async function runLightricksLtx13B(
  prompt: string,
  hfToken?: string
): Promise<GeneratedMediaResult> {
  const base = "https://lightricks-ltx-video-distilled.hf.space";
  const seed = Math.floor(100000 + Math.random() * 900000);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`;

  const data = [
    prompt,
    "worst quality, blurry, distorted, jittery, watermark, text",
    "",
    "",
    384,
    576,
    "text-to-video",
    2.5,
    9,
    seed,
    true,
    1,
    true,
  ];

  const sub = await fetch(`${base}/gradio_api/call/text_to_video`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(15000),
  });
  if (!sub.ok) throw new Error(`LTX-13B submit HTTP ${sub.status}`);
  const { event_id } = (await sub.json()) as { event_id?: string };
  if (!event_id) throw new Error("LTX-13B returned no event_id");

  const sseRes = await fetch(
    `${base}/gradio_api/call/text_to_video/${event_id}`,
    {
      headers,
      signal: AbortSignal.timeout(95000),
    }
  );
  if (!sseRes.ok) throw new Error(`LTX-13B stream HTTP ${sseRes.status}`);
  const payload = parseGradioCompletePayload(await sseRes.text()) as [
    { video?: { url?: string; path?: string } },
    number?,
  ];

  const vid = payload?.[0]?.video;
  const remoteUrl =
    vid?.url || (vid?.path ? `${base}/gradio_api/file=${vid.path}` : "");
  if (!remoteUrl) throw new Error("LTX-13B returned no video file");

  const localUrl = await cacheRemoteBinary(remoteUrl, "mp4", 30000, headers).catch(
    () => remoteUrl
  );

  return {
    url: localUrl,
    providerUsed: "Lightricks LTX-Video 13B Distilled (Keyless)",
    seed: typeof payload?.[1] === "number" ? payload[1] : seed,
    resolution: "576×384 MP4",
  };
}

async function runDeepRatLtxPro(
  prompt: string,
  hfToken?: string
): Promise<GeneratedMediaResult> {
  const base = "https://deeprat-ltx-video-zerogpu-optimized.hf.space";
  const seed = Math.floor(100000 + Math.random() * 900000);
  const slowMo = /\b(slow[- ]?mo(tion)?)\b/i.test(prompt);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`;

  const data = [
    prompt,
    "worst quality, inconsistent motion, blurry, jittery, distorted, watermark",
    null,
    null,
    384,
    576,
    "text-to-video",
    2.5,
    9,
    seed,
    true,
    1,
    true,
    slowMo,
  ];

  const sub = await fetch(`${base}/gradio_api/call/text_to_video`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(15000),
  });
  if (!sub.ok) throw new Error(`LTX-Pro submit HTTP ${sub.status}`);
  const { event_id } = (await sub.json()) as { event_id?: string };
  if (!event_id) throw new Error("LTX-Pro returned no event_id");

  const sseRes = await fetch(
    `${base}/gradio_api/call/text_to_video/${event_id}`,
    {
      headers,
      signal: AbortSignal.timeout(95000),
    }
  );
  if (!sseRes.ok) throw new Error(`LTX-Pro stream HTTP ${sseRes.status}`);
  const payload = parseGradioCompletePayload(await sseRes.text()) as [
    { video?: { url?: string; path?: string } },
    number?,
  ];

  const vid = payload?.[0]?.video;
  const remoteUrl =
    vid?.url || (vid?.path ? `${base}/gradio_api/file=${vid.path}` : "");
  if (!remoteUrl) throw new Error("LTX-Pro returned no video file");

  const localUrl = await cacheRemoteBinary(remoteUrl, "mp4", 30000, headers).catch(
    () => remoteUrl
  );

  return {
    url: localUrl,
    providerUsed: `LTX-Video ZeroGPU Pro${slowMo ? " (Slow-Mo)" : ""} (Keyless)`,
    seed: typeof payload?.[1] === "number" ? payload[1] : seed,
    resolution: "576×384 MP4",
  };
}

async function runAnimateDiffLightning(
  prompt: string,
  hfToken?: string
): Promise<GeneratedMediaResult> {
  const base = "https://bytedance-animatediff-lightning.hf.space";
  const isAnime =
    /\b(anime|manga|ghibli|cartoon|cel[- ]shaded|2d|illustration|chibi|waifu|naruto|cyberpunk anime)\b/i.test(
      prompt
    );
  const baseModel = isAnime ? "ToonYou" : "epiCRealism";

  let motion = "";
  if (/\bzoom[- ]?in\b/i.test(prompt))
    motion = "guoyww/animatediff-motion-lora-zoom-in";
  else if (/\bzoom[- ]?out\b/i.test(prompt))
    motion = "guoyww/animatediff-motion-lora-zoom-out";
  else if (/\bpan[- ]?left\b/i.test(prompt))
    motion = "guoyww/animatediff-motion-lora-pan-left";
  else if (/\bpan[- ]?right\b/i.test(prompt))
    motion = "guoyww/animatediff-motion-lora-pan-right";
  else if (/\btilt[- ]?up\b/i.test(prompt))
    motion = "guoyww/animatediff-motion-lora-tilt-up";
  else if (/\btilt[- ]?down\b/i.test(prompt))
    motion = "guoyww/animatediff-motion-lora-tilt-down";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`;

  const sub = await fetch(`${base}/call/generate_image`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: [prompt, baseModel, motion, 4] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!sub.ok) throw new Error(`AnimateDiff submit HTTP ${sub.status}`);
  const { event_id } = (await sub.json()) as { event_id?: string };
  if (!event_id) throw new Error("AnimateDiff returned no event_id");

  const sseRes = await fetch(`${base}/call/generate_image/${event_id}`, {
    headers,
    signal: AbortSignal.timeout(75000),
  });
  if (!sseRes.ok) throw new Error(`AnimateDiff stream HTTP ${sseRes.status}`);
  const payload = parseGradioCompletePayload(await sseRes.text()) as [
    { video?: { path?: string; url?: string } },
  ];

  const vPath = payload?.[0]?.video?.path;
  if (!vPath) throw new Error("AnimateDiff returned no video path");
  // Gradio 4.36 serves files cleanly at /file=<path>
  const remoteUrl = `${base}/file=${vPath}`;
  const localUrl = await cacheRemoteBinary(remoteUrl, "mp4", 30000, headers).catch(
    () => remoteUrl
  );

  return {
    url: localUrl,
    providerUsed: `ByteDance AnimateDiff-Lightning (${baseModel} Dedicated GPU)`,
    seed: Math.floor(100000 + Math.random() * 900000),
    resolution: "512×512 MP4",
  };
}

export async function generateKeylessVideo(opts: {
  prompt: string;
  preferred: VideoBackendId;
  hfToken?: string;
  onProgress?: (msg: string) => void;
}): Promise<GeneratedMediaResult> {
  const runners: Record<
    VideoBackendId,
    { label: string; fn: (p: string, t?: string) => Promise<GeneratedMediaResult> }
  > = {
    "ltx-video-13b": {
      label: "Lightricks LTX-Video 13B Distilled",
      fn: runLightricksLtx13B,
    },
    "ltx-zerogpu-pro": {
      label: "LTX-Video ZeroGPU Cinema Pro",
      fn: runDeepRatLtxPro,
    },
    "animatediff-lightning": {
      label: "ByteDance AnimateDiff-Lightning Dedicated GPU",
      fn: runAnimateDiffLightning,
    },
  };

  const order: VideoBackendId[] = [
    opts.preferred,
    ...(["ltx-video-13b", "animatediff-lightning", "ltx-zerogpu-pro"] as VideoBackendId[]).filter(
      (id) => id !== opts.preferred
    ),
  ];

  const errors: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const entry = runners[id];
    opts.onProgress?.(
      i === 0
        ? `Dispatching prompt to ${entry.label}…`
        : `Primary video queue busy — failing over to ${entry.label}…`
    );
    try {
      return await entry.fn(opts.prompt, opts.hfToken);
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`All keyless video clusters busy (${errors.join("; ")})`);
}

/* ===================================================================== *
 *  FREE KEYLESS IMAGE GENERATORS (5 INDEPENDENT ENGINES + FAILOVER)
 * ===================================================================== */

async function runOvhSdxl(prompt: string): Promise<GeneratedMediaResult> {
  const res = await fetch(
    "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/images/generations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "stable-diffusion-xl-base-v10",
        prompt,
      }),
      signal: AbortSignal.timeout(25000),
    }
  );
  if (!res.ok) throw new Error(`OVH SDXL HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OVH SDXL returned empty b64_json");
  const localUrl = await saveMediaBuffer(Buffer.from(b64, "base64"), "png");
  return {
    url: localUrl,
    providerUsed: "Stability AI SDXL 1.0 FP32 (OVH Bare-Metal Keyless)",
    seed: Math.floor(100000 + Math.random() * 900000),
    resolution: "1024×1024 PNG",
  };
}

async function runBflFluxSchnell(
  prompt: string,
  hfToken?: string
): Promise<GeneratedMediaResult> {
  const base = "https://black-forest-labs-flux-1-schnell.hf.space";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`;

  const sub = await fetch(`${base}/gradio_api/call/infer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: [prompt, 0, true, 1024, 768, 4] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!sub.ok) throw new Error(`BFL Flux submit HTTP ${sub.status}`);
  const { event_id } = (await sub.json()) as { event_id?: string };
  if (!event_id) throw new Error("BFL Flux no event_id");

  const sseRes = await fetch(`${base}/gradio_api/call/infer/${event_id}`, {
    headers,
    signal: AbortSignal.timeout(45000),
  });
  if (!sseRes.ok) throw new Error(`BFL Flux stream HTTP ${sseRes.status}`);
  const payload = parseGradioCompletePayload(await sseRes.text()) as [
    { url?: string; path?: string },
    number?,
  ];
  const img = payload?.[0];
  const remoteUrl =
    img?.url || (img?.path ? `${base}/gradio_api/file=${img.path}` : "");
  if (!remoteUrl) throw new Error("BFL Flux returned no image URL");

  // Persist provider output before reporting success; remote Gradio URLs can expire.
  const localUrl = await cacheRemoteBinary(
    remoteUrl,
    "webp",
    20000,
    headers
  );

  return {
    url: localUrl,
    providerUsed: "Black Forest Labs FLUX.1-Schnell Official (Keyless)",
    seed: typeof payload?.[1] === "number" ? payload[1] : 0,
    resolution: "1024×768 WebP",
  };
}

async function runPollinationsModel(
  prompt: string,
  modelName: "sana" | "flux",
  label: string
): Promise<GeneratedMediaResult> {
  const seed = Math.floor(100000 + Math.random() * 900000);
  const enhanced = `${prompt}, ultra-detailed, sharp focus, 8k masterpiece`;
  const remoteUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    enhanced
  )}?width=1024&height=768&seed=${seed}&nologo=true&model=${modelName}`;

  const localUrl = await cacheRemoteBinary(remoteUrl, "jpg", 22000);
  return {
    url: localUrl,
    providerUsed: label,
    seed,
    resolution: "1024×768 HD",
  };
}

async function runAiHordeImage(
  prompt: string,
  hordeKey?: string
): Promise<GeneratedMediaResult> {
  const apikey = hordeKey?.trim() || "0000000000";
  const sub = await fetch("https://aihorde.net/api/v2/generate/async", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey,
      "Client-Agent": "RevengeGPT:7.0:IdamEmmanuel",
    },
    body: JSON.stringify({
      prompt: `${prompt} ### blurry, low quality, deformed, watermark`,
      params: {
        sampler_name: "k_euler_a",
        cfg_scale: 7,
        width: 512,
        height: 512,
        steps: 22,
        n: 1,
      },
      nsfw: false,
      censor_nsfw: false,
      models: [
        "Deliberate",
        "Dreamshaper",
        "ICBINP - I Can't Believe It's Not Photography",
        "AbsoluteReality",
      ],
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!sub.ok) throw new Error(`AI Horde submit HTTP ${sub.status}`);
  const { id } = (await sub.json()) as { id?: string };
  if (!id) throw new Error("AI Horde returned no job ID");

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const stRes = await fetch(
      `https://aihorde.net/api/v2/generate/status/${id}`,
      {
        headers: { apikey, "Client-Agent": "RevengeGPT:7.0:IdamEmmanuel" },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!stRes.ok) continue;
    const st = (await stRes.json()) as {
      done?: boolean;
      faulted?: boolean;
      generations?: Array<{ img?: string; model?: string; seed?: string }>;
    };
    if (st.faulted) throw new Error("AI Horde worker faulted");
    if (st.done && st.generations?.[0]?.img) {
      const gen = st.generations[0];
      const imgField = gen.img!;
      let localUrl = imgField;
      if (imgField.startsWith("http")) {
        localUrl = await cacheRemoteBinary(imgField, "webp", 15000);
      } else {
        const encodedImage = imgField.replace(new RegExp("^data:image/[a-z0-9.+-]+;base64,", "i"), "");
        localUrl = await saveMediaBuffer(
          Buffer.from(encodedImage, "base64"),
          "webp"
        );
      }
      return {
        url: localUrl,
        providerUsed: `AI Horde GPU Grid • ${gen.model || "DreamShaper"} (Keyless)`,
        seed: Number(gen.seed) || 42,
        resolution: "512×512 WebP",
      };
    }
  }
  throw new Error("AI Horde queue timeout");
}

export async function generateKeylessImage(opts: {
  prompt: string;
  preferred: ImageBackendId;
  hfToken?: string;
  hordeKey?: string;
  onProgress?: (msg: string) => void;
}): Promise<GeneratedMediaResult> {
  const runners: Record<
    ImageBackendId,
    { label: string; fn: () => Promise<GeneratedMediaResult> }
  > = {
    "ovh-sdxl": {
      label: "OVH Bare-Metal SDXL 1.0 FP32",
      fn: () => runOvhSdxl(opts.prompt),
    },
    "bfl-flux-schnell": {
      label: "Black Forest Labs FLUX.1-Schnell",
      fn: () => runBflFluxSchnell(opts.prompt, opts.hfToken),
    },
    "nvidia-sana": {
      label: "NVIDIA Sana 1024px Diffusion",
      fn: () =>
        runPollinationsModel(
          opts.prompt,
          "sana",
          "NVIDIA Sana 1024px Diffusion (Keyless)"
        ),
    },
    "pollinations-flux": {
      label: "Pollinations Flux HD",
      fn: () =>
        runPollinationsModel(
          opts.prompt,
          "flux",
          "Pollinations Flux HD Studio (Keyless)"
        ),
    },
    "aihorde-sd": {
      label: "AI Horde Community GPU Grid",
      fn: () => runAiHordeImage(opts.prompt, opts.hordeKey),
    },
  };

  const allOrder: ImageBackendId[] = [
    "ovh-sdxl",
    "nvidia-sana",
    "bfl-flux-schnell",
    "pollinations-flux",
    "aihorde-sd",
  ];
  const order: ImageBackendId[] = [
    opts.preferred,
    ...allOrder.filter((id) => id !== opts.preferred),
  ];

  const errors: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const entry = runners[id];
    opts.onProgress?.(
      i === 0
        ? `Rendering on ${entry.label}…`
        : `Failing over to ${entry.label}…`
    );
    try {
      return await entry.fn();
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`All 5 image engines busy (${errors.join("; ")})`);
}
