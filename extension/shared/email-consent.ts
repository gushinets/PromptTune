import browser from "webextension-polyfill";

const LEGACY_KEY = "email_bonus_data_consent";
const PERMISSION = { data_collection: ["personallyIdentifyingInfo" as const] };
export interface EmailConsent {
  native: boolean;
  granted: boolean;
}

export async function getEmailConsent(): Promise<EmailConsent> {
  if (!import.meta.env.FIREFOX) return { native: false, granted: true };
  const permissions = await browser.permissions.getAll();
  if (Array.isArray(permissions.data_collection)) {
    return {
      native: true,
      granted: permissions.data_collection.includes("personallyIdentifyingInfo"),
    };
  }
  const data = await browser.storage.local.get(LEGACY_KEY);
  return { native: false, granted: data[LEGACY_KEY] === true };
}

/** Called directly in a checkbox's user-activated event, before any await. */
export async function changeEmailConsent(granted: boolean, native: boolean): Promise<boolean> {
  if (native) {
    if (granted) return browser.permissions.request(PERMISSION);
    await browser.permissions.remove(PERMISSION);
    return false;
  }
  await browser.storage.local.set({ [LEGACY_KEY]: granted });
  return granted;
}

export async function requireEmailConsent(): Promise<void> {
  if (!(await getEmailConsent()).granted)
    throw new Error("Email data sharing consent is required.");
}
