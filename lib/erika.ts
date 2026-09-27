export const ERIKA = {
  trigger: "ERIKAFINAL",
  name: "Erika",
  identity:
    "ERIKAFINAL woman, exact same woman as always, same face, same body, long dark wavy hair, brown eyes, no tattoos",
  settingDefault: "ordinary bedroom",
};

export type PhotoSlots = {
  pose: string;
  clothing: string;
  framing: string;
  setting: string;
};

const HARD_POSE =
  /behind|from behind|all fours|hands and knees|doggy|on her knees/i;

export function isHardPose(text: string) {
  return HARD_POSE.test(text);
}

export function slotsFromUserText(userText: string): PhotoSlots {
  const text = userText.toLowerCase();

  let pose = "standing facing the camera";
  if (text.includes("stomach") || text.includes("on your stomach")) {
    pose = "lying on her stomach, looking back over her shoulder";
  } else if (text.includes("all fours") || text.includes("hands and knees") || text.includes("doggy")) {
    pose = "on her hands and knees on the bed, camera behind her, head turned toward the camera";
  } else if (text.includes("from behind") || text.includes("facing away") || text.includes("your ass")) {
    pose = "standing with her back to the camera, looking back over her shoulder";
  } else if (text.includes("sitting") || text.includes("on the bed")) {
    pose = "sitting on the edge of the bed facing the camera";
  } else if (text.includes("lying") || text.includes("laying") || text.includes("on your back")) {
    pose = "lying on her back on the bed looking at the camera";
  }

  let clothing = "casual indoor clothes";
  if (text.includes("nude") || text.includes("naked") || text.includes("nothing on")) {
    clothing = "nude";
  } else if (text.includes("panti")) {
    clothing = "only panties";
  } else if (text.includes("jeans")) {
    clothing = "light wash jeans and a simple top";
  } else if (text.includes("dress")) {
    clothing = "a simple cute dress";
  } else if (text.includes("tank")) {
    clothing = "a thin tank top and panties";
  } else if (text.includes("lingerie") || text.includes("sexy")) {
    clothing = "simple lingerie";
  }

  let framing = "waist-up";
  if (text.includes("full body") || text.includes("head to toe") || isHardPose(text)) {
    framing = "full body in frame";
  } else if (text.includes("crop") || text.includes("thigh")) {
    framing = "cropped at mid-thigh";
  }

  return {
    pose,
    clothing,
    framing,
    setting: ERIKA.settingDefault,
  };
}

export function compilePhotoPrompt(slots: PhotoSlots) {
  return [
    ERIKA.identity,
    slots.pose,
    `wearing ${slots.clothing}`,
    slots.framing,
    slots.setting,
    "candid iphone photo, natural indoor light, real skin",
  ].join(", ");
}

export function photoSettings(slots: PhotoSlots) {
  if (isHardPose(`${slots.pose} ${slots.framing}`)) {
    return {
      lora_scale: 0.7,
      extra_lora_scale: 0.25,
      guidance: 2.2,
      aspect_ratio: "3:4",
      num_outputs: 2,
    };
  }

  return {
    lora_scale: 0.85,
    extra_lora_scale: 0.5,
    guidance: 2.3,
    aspect_ratio: "4:5",
    num_outputs: 1,
  };
}
