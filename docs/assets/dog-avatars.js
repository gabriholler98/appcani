export const dogAvatars = [
  ["avatar:meticcio", "Meticcio", "meticcio"],
  ["avatar:labrador-retriever", "Labrador Retriever", "labrador-retriever"],
  ["avatar:golden-retriever", "Golden Retriever", "golden-retriever"],
  ["avatar:pastore-tedesco", "Pastore tedesco", "pastore-tedesco"],
  ["avatar:chihuahua", "Chihuahua", "chihuahua"],
  ["avatar:barboncino", "Barboncino", "barboncino"],
  ["avatar:jack-russell-terrier", "Jack Russell Terrier", "jack-russell-terrier"],
  ["avatar:bulldog-francese", "Bulldog francese", "bulldog-francese"],
  ["avatar:beagle", "Beagle", "beagle"],
  ["avatar:bassotto", "Bassotto", "bassotto"],
  ["avatar:maltese", "Maltese", "maltese"],
  ["avatar:border-collie", "Border Collie", "border-collie"],
  ["avatar:cocker-spaniel-inglese", "Cocker spaniel inglese", "cocker-spaniel-inglese"],
  ["avatar:yorkshire-terrier", "Yorkshire Terrier", "yorkshire-terrier"],
  ["avatar:cane-corso", "Cane Corso", "cane-corso"],
  ["avatar:pastore-australiano", "Pastore australiano", "pastore-australiano"],
  ["avatar:carlino", "Carlino", "carlino"],
  ["avatar:shih-tzu", "Shih Tzu", "shih-tzu"],
  ["avatar:boxer", "Boxer", "boxer"],
  ["avatar:rottweiler", "Rottweiler", "rottweiler"],
  ["avatar:pinscher-nano", "Pinscher nano", "pinscher-nano"],
  ["avatar:setter-inglese", "Setter inglese", "setter-inglese"],
  ["avatar:volpino-italiano", "Volpino italiano", "volpino-italiano"],
  ["avatar:lagotto-romagnolo", "Lagotto romagnolo", "lagotto-romagnolo"],
  ["avatar:husky-siberiano", "Husky siberiano", "husky-siberiano"],
].map(([value,label,file])=>({value,label,src:`./assets/dog-avatars/${file}.png`}));

const avatars=new Map(dogAvatars.map(avatar=>[avatar.value,avatar]));
const descriptions=[
  "Cane marrone con orecchie morbide","Cane chiaro dal pelo corto","Cane dorato dal pelo lungo",
  "Cane nero e marrone con orecchie dritte","Cane piccolo con grandi orecchie","Cane riccio color miele",
  "Cane bianco con macchie marroni","Cane con muso corto e grandi orecchie","Cane tricolore con orecchie pendenti",
  "Cane marrone con orecchie lunghe","Cane bianco dal pelo lungo","Cane bianco e nero",
  "Cane dal pelo ondulato con orecchie lunghe","Cane dal pelo lungo grigio e marrone",
  "Cane scuro con muso largo","Cane dal mantello variopinto","Cane beige con muso scuro",
  "Cane bianco e marrone dal pelo lungo","Cane fulvo con muso squadrato","Cane nero con sopracciglia marroni",
  "Cane dal pelo corto con orecchie appuntite","Cane maculato dal pelo lungo","Cane bianco con orecchie appuntite",
  "Cane riccio marrone","Cane grigio e bianco con orecchie dritte",
];

export const avatarFor=value=>avatars.get(value);

export function appendDogAvatar(target,value,className="dog-avatar-inline") {
  const avatar=avatarFor(value);
  if (!avatar) return false;
  const image=document.createElement("img");
  image.src=avatar.src;
  image.alt="";
  image.className=className;
  image.width=48;
  image.height=48;
  target.append(image);
  return true;
}

export function renderDogAvatar(target,value) {
  target.replaceChildren();
  if (!appendDogAvatar(target,value,"dog-avatar")) target.textContent=value||"🐕";
}

export function populateDogAvatarPicker(target) {
  target.replaceChildren(...dogAvatars.map((avatar,index)=>{
    const label=document.createElement("label");
    label.className="dog-avatar-choice";
    const input=document.createElement("input");
    input.type="radio";
    input.name="emoji";
    input.value=avatar.value;
    input.required=true;
    input.setAttribute("aria-label",descriptions[index]);
    const image=document.createElement("img");
    image.src=avatar.src;
    image.alt="";
    image.width=56;
    image.height=56;
    label.append(input,image);
    return label;
  }));
}
