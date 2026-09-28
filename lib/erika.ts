export const ERIKA = {
  trigger: "ERIKAFINAL",
  name: "Erika",
  identity:
    "ERIKAFINAL woman, one woman only, exact same woman as always, same face, same body, long dark wavy hair, brown eyes",
  room:
    "ordinary bedroom, beige wall, wood bed frame, white sheets, lamp on the right, candid iphone photo, natural indoor light, real skin",
  timezone: "America/Los_Angeles",
  sceneLockMs: 90 * 60 * 1000,
};

export type ErikaState = {
  id: number;
  location: string;
  top: string | null;
  bottom: string | null;
  underwear: string | null;
  shoes: string | null;
  pose: string;
  name_for_user: string;
  last_photo_url: string | null;
  scene_at: string;
  updated_at: string;
};

export type StatePatch = Partial<
  Pick<
    ErikaState,
    "location" | "top" | "bottom" | "underwear" | "shoes" | "pose"
  >
>;

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function hourInOregon(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ERIKA.timezone,
      hour: "numeric",
      hour12: false,
    }).format(date)
  );
  return hour;
}

export function presetForNow(date = new Date()) {
  const hour = hourInOregon(date);

  if (hour >= 7 && hour < 10) {
    return {
      top: "oversized white t-shirt",
      bottom: null as string | null,
      underwear: "grey panties",
      shoes: null as string | null,
      pose: "sitting on the bed",
      location: "bedroom",
    };
  }

  if (hour >= 10 && hour < 18) {
    return {
      top: "white tank top",
      bottom: "light blue jeans",
      underwear: "grey panties",
      shoes: null as string | null,
      pose: "standing facing the camera",
      location: "bedroom",
    };
  }

  if (hour >= 18 && hour < 23) {
    return {
      top: "soft tank top",
      bottom: null as string | null,
      underwear: "grey panties",
      shoes: null as string | null,
      pose: "sitting on the bed",
      location: "bedroom",
    };
  }

  return {
    top: null as string | null,
    bottom: null as string | null,
    underwear: "grey panties",
    shoes: null as string | null,
    pose: "lying on the bed",
    location: "bedroom",
  };
}

export function sceneIsStale(state: ErikaState, now = Date.now()) {
  const sceneAt = new Date(state.scene_at).getTime();
  if (Number.isNaN(sceneAt)) return true;
  return now - sceneAt > ERIKA.sceneLockMs;
}

export function applyPatch(state: ErikaState, patch: StatePatch): ErikaState {
  return {
    ...state,
    ...patch,
    scene_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function clothingLine(state: ErikaState) {
  if (!state.top && !state.bottom && !state.underwear) return "nude";
  if (!state.top && !state.bottom && state.underwear) {
    return `only ${state.underwear}`;
  }
  if (!state.top && state.bottom) {
    return `${state.bottom}, no top, ${state.underwear || "bare chest"}`;
  }

  const parts: string[] = [];
  if (state.top) parts.push(state.top);
  if (state.bottom) parts.push(state.bottom);
  if (state.underwear && (!state.top || !state.bottom)) {
    parts.push(state.underwear);
  }
  if (state.shoes) parts.push(state.shoes);
  return parts.join(" and ");
}

export function compilePhotoPromptFromState(state: ErikaState) {
  return [
    ERIKA.identity,
    "single person, no second woman",
    state.pose || "standing facing the camera",
    `wearing ${clothingLine(state)}`,
    ERIKA.room,
  ].join(", ");
}

export function looksLikePhotoRequest(text: string) {
  return /(photo|pic|picture|selfie|send me|show me|let me see)/i.test(text);
}

export function patchFromUserText(text: string): StatePatch {
  const t = text.toLowerCase();
  const patch: StatePatch = {};

  if (
    /(take|remove).*(shirt|top)|shirt off|top off|take it off/i.test(t)
  ) {
    patch.top = null;
  }

  if (/(take|remove).*(pants|jeans)|pants off|jeans off/i.test(t)) {
    patch.bottom = null;
  }

  if (/(naked|nude|take it all off|nothing on)/i.test(t)) {
    patch.top = null;
    patch.bottom = null;
  }

  if (/put on.*(jeans)|wear.*(jeans)/i.test(t)) {
    patch.bottom = "light blue jeans";
  }

  if (/put on.*(dress)|wear.*(dress)/i.test(t)) {
    patch.top = "a simple cute dress";
    patch.bottom = null;
  }

  if (/put (your )?shirt on|put (your )?top on/i.test(t)) {
    patch.top = "white tank top";
  }

  if (/sitting|sit down|sit on/i.test(t)) {
    patch.pose = "sitting on the bed facing the camera";
  }

  if (/stand|standing/i.test(t)) {
    patch.pose = "standing facing the camera";
  }

  return patch;
}

export function photoSettings() {
  return {
    lora_scale: 0.85,
    extra_lora_scale: 0.4,
    guidance: 2.3,
    aspect_ratio: "4:5",
    num_outputs: 1,
  };
}

async function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function loadState(): Promise<ErikaState> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/erika_state?id=eq.1&select=*`,
    {
      headers: await supabaseHeaders(),
      cache: "no-store",
    }
  );

  const rows = await response.json();

  if (!response.ok || !Array.isArray(rows) || !rows[0]) {
    console.error("LOAD STATE ERROR:", rows);
    throw new Error("Could not load Erika state");
  }

  return rows[0] as ErikaState;
}

export async function saveState(state: ErikaState) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/erika_state?id=eq.1`,
    {
      method: "PATCH",
      headers: {
        ...(await supabaseHeaders()),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        location: state.location,
        top: state.top,
        bottom: state.bottom,
        underwear: state.underwear,
        shoes: state.shoes,
        pose: state.pose,
        name_for_user: state.name_for_user,
        last_photo_url: state.last_photo_url,
        scene_at: state.scene_at,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("SAVE STATE ERROR:", errorText);
    throw new Error("Could not save Erika state");
  }
}

export async function loadOrResetState(): Promise<ErikaState> {
  let state = await loadState();

  if (sceneIsStale(state)) {
    const preset = presetForNow();
    state = applyPatch(state, preset);
    await saveState(state);
    console.log("CLOCK DRESSED ERIKA:", clothingLine(state));
  }

  return state;
}
