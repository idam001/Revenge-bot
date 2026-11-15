"use client";
/* eslint @next/next/no-img-element: off -- locally selected artwork is drawn onto canvas. */
import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus, LayoutTemplate, Type, WandSparkles } from "lucide-react";

const templates = [
  { id: "post", label: "Social post", width: 1080, height: 1080, bg: "#171c35", accent: "#ff765e" },
  { id: "story", label: "Story", width: 1080, height: 1920, bg: "#301b48", accent: "#f29ce2" },
  { id: "thumbnail", label: "Video thumbnail", width: 1280, height: 720, bg: "#102d35", accent: "#6ee7d5" },
  { id: "poster", label: "Poster", width: 1200, height: 1600, bg: "#2e2020", accent: "#ffca79" },
];
const fonts = ["Arial", "Georgia", "Impact", "Trebuchet MS", "Courier New"];

export function CanvasStudioWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [templateId, setTemplateId] = useState("post");
  const template = templates.find(item=>item.id===templateId) || templates[0];
  const [title, setTitle] = useState("Make something bold");
  const [subtitle, setSubtitle] = useState("Your idea, beautifully laid out.");
  const [background, setBackground] = useState(template.bg);
  const [accent, setAccent] = useState(template.accent);
  const [font, setFont] = useState("Arial");
  const [image, setImage] = useState("");
  const [imageError, setImageError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas)return;
    const ctx=canvas.getContext("2d");
    if(!ctx)return;
    const scale=Math.min(900/template.width,650/template.height,1);
    canvas.width=template.width;canvas.height=template.height;
    canvas.style.width=`${Math.max(220,template.width*scale)}px`;
    canvas.style.height=`${Math.max(220,template.height*scale)}px`;
    const w=canvas.width,h=canvas.height;
    const grad=ctx.createLinearGradient(0,0,w,h);grad.addColorStop(0,background);grad.addColorStop(1,"#0d1019");
    ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
    const drawText=()=>{
      ctx.fillStyle=accent;ctx.fillRect(w*0.09,h*0.13,w*0.15,Math.max(8,h*0.009));
      ctx.textAlign="left";ctx.textBaseline="top";ctx.fillStyle="#ffffff";
      const maxWidth=w*0.82;let size=Math.min(w*0.105,h*0.13);ctx.font=`800 ${size}px "${font}"`;
      while(ctx.measureText(title||" ").width>maxWidth&&size>18){size-=2;ctx.font=`800 ${size}px "${font}"`;}
      const words=(title||" ").split(/\s+/);let lines:string[]=[],line="";
      for(const word of words){const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word;}else line=test;}if(line)lines.push(line);
      const titleY=image?h*0.66:h*0.37;const lineHeight=size*1.12;
      lines.slice(0,4).forEach((text,i)=>ctx.fillText(text,w*0.09,titleY+i*lineHeight));
      const subY=titleY+Math.min(lines.length,4)*lineHeight+Math.max(15,h*0.025);
      ctx.font=`500 ${Math.max(15,w*0.028)}px "${font}"`;ctx.fillStyle="rgba(255,255,255,.78)";
      const words2=(subtitle||"").split(/\s+/);let sub="",offset=0;
      for(const word of words2){const test=sub?`${sub} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&sub){ctx.fillText(sub,w*0.09,subY+offset);offset+=Math.max(18,h*0.035);sub=word;}else sub=test;}if(sub)ctx.fillText(sub,w*0.09,subY+offset);
      ctx.fillStyle=accent;ctx.font=`700 ${Math.max(12,w*0.018)}px Arial`;ctx.fillText("MADE IN REVENGE CANVAS",w*0.09,h*0.91);
    };
    if(image){const img=new Image();img.onload=()=>{ctx.save();ctx.globalAlpha=.38;const ratio=Math.max(w/img.width,h*0.55/img.height);const iw=img.width*ratio,ih=img.height*ratio;ctx.drawImage(img,(w-iw)/2,h*.08,iw,Math.min(ih,h*.65));ctx.restore();ctx.fillStyle="rgba(8,10,18,.44)";ctx.fillRect(0,h*.48,w,h*.52);drawText();};img.onerror=()=>drawText();img.src=image;}else drawText();
  },[template,background,accent,font,title,subtitle,image]);

  const uploadImage=(file?:File)=>{setImageError("");if(!file)return;if(!file.type.startsWith("image/")){setImageError("Choose an image file.");return;}if(file.size>10*1024*1024){setImageError("Choose an image smaller than 10 MB.");return;}const reader=new FileReader();reader.onload=()=>{setImage(typeof reader.result==="string"?reader.result:"");};reader.onerror=()=>setImageError("Couldn’t open that image.");reader.readAsDataURL(file);};
  const download=()=>{const canvas=canvasRef.current;if(!canvas)return;const a=document.createElement("a");a.download=`revenge-canvas-${template.id}.png`;a.href=canvas.toDataURL("image/png");a.click();setSaved(true);setTimeout(()=>setSaved(false),1800);};
  return <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6"><section className="mb-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7"><div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-pink-500/10 text-pink-300"><LayoutTemplate size={21}/></span><div><div className="text-xs font-bold uppercase tracking-[0.18em] text-pink-300">Design · preview · export</div><h1 className="mt-1 text-2xl font-semibold">Canvas Studio</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">A quick Canva-style workspace for social posts, stories, thumbnails, and posters. Everything is drawn in your browser.</p></div></div></section>
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"><aside className="space-y-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-5"><label className="block text-sm font-semibold">Start from a layout<select className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-3 text-sm" value={templateId} onChange={e=>{const next=templates.find(item=>item.id===e.target.value);setTemplateId(e.target.value);if(next){setBackground(next.bg);setAccent(next.accent);}}}>{templates.map(t=><option key={t.id} value={t.id}>{t.label} · {t.width}×{t.height}</option>)}</select></label><label className="block text-sm font-semibold"><span className="flex items-center gap-2"><Type size={15}/> Headline</span><textarea className="mt-2 min-h-24 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-3 text-sm font-normal" maxLength={90} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Your headline"/></label><label className="block text-sm font-semibold">Supporting text<textarea className="mt-2 min-h-20 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-3 text-sm font-normal" maxLength={160} value={subtitle} onChange={e=>setSubtitle(e.target.value)} placeholder="Add a short caption"/></label><label className="block text-sm font-semibold">Typeface<select className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-3 text-sm font-normal" value={font} onChange={e=>setFont(e.target.value)}>{fonts.map(f=><option key={f}>{f}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold">Background<span className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-2"><input aria-label="Background color" type="color" value={background} onChange={e=>setBackground(e.target.value)} className="h-8 w-10 cursor-pointer border-0 bg-transparent"/><code>{background}</code></span></label><label className="block text-xs font-semibold">Accent<span className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-2"><input aria-label="Accent color" type="color" value={accent} onChange={e=>setAccent(e.target.value)} className="h-8 w-10 cursor-pointer border-0 bg-transparent"/><code>{accent}</code></span></label></div><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] px-3 py-3 text-sm hover:border-pink-400"><ImagePlus size={16}/> Add a photo<input className="sr-only" type="file" accept="image/*" onChange={e=>uploadImage(e.target.files?.[0])}/></label>{image&&<button type="button" onClick={()=>setImage("")} className="w-full text-xs text-[var(--text-muted)] underline">Remove photo</button>}{imageError&&<p role="alert" className="text-xs text-red-300">{imageError}</p>}<button type="button" onClick={download} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-500"><Download size={16}/>{saved?"PNG saved":"Download PNG"}</button><p className="text-[11px] leading-5 text-[var(--text-muted)]">Use images you own or have permission to use. Your upload stays in this browser session.</p></aside>
    <section className="flex min-h-[480px] items-center justify-center overflow-auto rounded-3xl border border-[var(--border-subtle)] bg-[#101116] p-4 sm:p-8"><canvas ref={canvasRef} className="max-h-[76vh] max-w-full rounded-lg shadow-2xl shadow-black/50"/></section></div>
    <div className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]"><WandSparkles size={14} className="text-[var(--accent)]"/>More templates and shared brand kits can be added without changing how you export your designs.</div>
  </div>;
}
