import {byId,status} from "./ui.js?v=8";

export function setupPhotoEditor() {
  const canvas=byId("photoCanvas"),box=byId("photoCrop");
  const controls=["cropZoom","cropX","cropY"].map(byId);
  let image=null,url=null,pending=0;
  function draw() {
    if(!image)return;
    const zoom=Number(controls[0].value);
    const side=Math.min(image.naturalWidth,image.naturalHeight)/zoom;
    const x=(image.naturalWidth-side)*(Number(controls[1].value)+1)/2;
    const y=(image.naturalHeight-side)*(Number(controls[2].value)+1)/2;
    const context=canvas.getContext("2d");
    context.fillStyle="white";
    context.fillRect(0,0,384,384);
    context.drawImage(image,x,y,side,side,0,0,384,384);
  }
  controls.forEach(control=>{control.oninput=draw;});
  function clear() {
    pending+=1;
    if(url)URL.revokeObjectURL(url);
    image=url=null;
    box.hidden=true;
    controls[0].value="1";controls[1].value=controls[2].value="0";
  }
  return {
    clear,
    async choose(file) {
      clear();
      if(!file?.size||file.size>20*1024*1024)throw new Error("Scegli una foto JPG, PNG o WebP di massimo 20 MB.");
      const version=pending;
      url=URL.createObjectURL(file);
      const next=new Image();
      next.src=url;
      await next.decode().catch(()=>{throw new Error("Foto non leggibile. Prova con un file JPG o PNG.");});
      if(version!==pending)return false;
      image=next;
      box.hidden=false;
      draw();
      return true;
    },
    hasDraft:()=>Boolean(image),
    async blob() {
      if(!image)return null;
      for(const quality of [.82,.7,.55,.4]) {
        const result=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
        if(result?.size<=80*1024)return result;
      }
      throw new Error("Foto troppo grande. Scegli un’altra immagine.");
    },
  };
}
