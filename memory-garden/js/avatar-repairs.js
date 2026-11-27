// Non-destructive compositor corrections. Coordinates are in each source layer.
// Source images remain unchanged; Figma uses the same clipping paths.
export const HAIR_REPAIRS = {
  hair_g: {
    patches: [[88,135,60,20,88,113,60,20],[205,134,52,20,205,112,52,20]],
    cut: 'M74 194 L107 187 L111 165 L117 187 L151 186 L152 169 L166 131 L171 157 L183 181 L227 180 L230 162 L237 180 L281 181 L281 262 L71 262 Z'
  },
  hair_b: { cut: 'M72 209 L99 147 L106 178 L119 211 L121 185 L147 140 L151 178 L176 218 L200 249 L196 177 L219 207 L240 216 L233 174 L263 199 L282 225 L278 262 L271 293 L74 299 Z' },
  hair_s: { cut: 'M63 193 L65 175 L72 203 L80 203 L91 151 L113 109 L129 150 L148 183 L171 213 L192 237 L172 196 L165 166 L164 153 L184 181 L205 195 L242 202 L232 178 L225 151 L238 164 L261 187 L290 219 L283 265 L266 281 L294 340 L45 340 L74 278 Z' },
  hair_wave: {
    patches: [[104,133,60,20,104,110,60,20],[223,132,51,20,223,109,51,20]],
    cut: 'M82 180 L119 180 L122 163 L127 179 L180 178 L180 153 L193 116 L200 157 L201 177 L245 177 L248 160 L252 178 L297 180 L297 274 L83 274 Z'
  },
  hair_pony: { cut: 'M44 197 L48 151 L48 194 L70 159 L99 126 L100 164 L112 200 L126 150 L142 111 L151 147 L167 170 L197 198 L187 162 L180 122 L195 145 L215 166 L253 190 L237 165 L224 129 L248 150 L273 196 L270 254 L48 254 Z' },
  hair_curly: { cut: 'M100 129 L128 106 L141 118 L169 139 L153 166 L166 180 L184 191 L177 205 L175 212 L191 211 L209 192 L196 171 L222 143 L224 138 L257 151 L272 179 L296 191 L296 251 L76 251 L76 190 L102 167 Z' }
};

// Only temples are extended, behind the unchanged face texture and hair.
export const TEMPLE_PADS = [
  { path: 'M95 170 L83 187 L74 221 L77 251 L92 276 L109 292 L113 268 L104 231 L104 177 Z', color: '#ECC9C0' },
  { path: 'M326 170 L340 188 L350 220 L346 249 L331 275 L315 291 L312 267 L319 229 L317 177 Z', color: '#E9C1B5' }
];

export function repairHair(name, image, makeCanvas, Path) {
  const spec = HAIR_REPAIRS[name];
  if (!spec) return image;
  const canvas = makeCanvas(image.width, image.height), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  for (const [x,y,w,h,sx,sy,sw,sh] of spec.patches || []) ctx.drawImage(image,sx,sy,sw,sh,x,y,w,h);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fill(new Path(spec.cut));
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// Remove only warm, pale pixels connected to the transparent boundary.
// Interior whites (e.g. teeth) and the dark outlines are retained.
export function cleanFaceEdges(name, image, makeCanvas) {
  if (!/^(eyes_|mouth_|blush_)/.test(name)) return image;
  const c=makeCanvas(image.width,image.height),g=c.getContext('2d');g.drawImage(image,0,0);
  const d=g.getImageData(0,0,c.width,c.height),p=d.data,w=c.width,h=c.height;
  const seen=new Uint8Array(w*h),queue=[];
  const candidate=i=>{const k=i*4,r=p[k],gg=p[k+1],b=p[k+2];return p[k+3]>0 && r>gg+10 && gg>=b && .299*r+.587*gg+.114*b>150 && (r-gg)/r<.25;};
  for(let i=0;i<w*h;i++)if(candidate(i)){
    const x=i%w,y=Math.floor(i/w);
    if(!x||x===w-1||!y||y===h-1||!p[(i-1)*4+3]||!p[(i+1)*4+3]||!p[(i-w)*4+3]||!p[(i+w)*4+3]){seen[i]=1;queue.push(i);}
  }
  for(let q=0;q<queue.length;q++){
    const i=queue[q];p[i*4+3]=0;
    const x=i%w,y=Math.floor(i/w);
    for(const j of [x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<h-1?i+w:-1])if(j>=0&&!seen[j]&&candidate(j)){seen[j]=1;queue.push(j);}
  }
  g.putImageData(d,0,0);return c;
}
