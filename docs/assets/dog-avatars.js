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
  target.replaceChildren(...dogAvatars.map(avatar=>{
    const label=document.createElement("label");
    label.className="dog-avatar-choice";
    label.title=avatar.label;
    const input=document.createElement("input");
    input.type="radio";
    input.name="emoji";
    input.value=avatar.value;
    input.required=true;
    const image=document.createElement("img");
    image.src=avatar.src;
    image.alt="";
    image.width=56;
    image.height=56;
    const name=document.createElement("span");
    name.textContent=avatar.label;
    label.append(input,image,name);
    return label;
  }));
}
