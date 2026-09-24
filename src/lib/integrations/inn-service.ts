import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { lookupPartyByInn, validateInn, type InnLookupResult } from "./inn";

export const INN_PROFILE_SYSTEM = "DADATA";

/** Ключ DaData из профиля интеграции (хранится зашифрованным); null — сервис не настроен или выключен. */
export async function getDadataApiKey(): Promise<string | null> {
  const profile = await prisma.integrationProfile.findFirst({ where: { system: INN_PROFILE_SYSTEM } });
  const apiKeyEnc = (profile?.config as { apiKeyEnc?: string } | null)?.apiKeyEnc;
  if (!profile?.isEnabled || !apiKeyEnc) return null;
  return decryptSecret(apiKeyEnc);
}

export async function lookupRequisitesByInn(inn: string): Promise<InnLookupResult> {
  // A typo is reported even without the service configured.
  const invalid = validateInn(inn);
  if (invalid) return { found: false, error: invalid };
  const apiKey = await getDadataApiKey();
  if (!apiKey) {
    return {
      found: false,
      error: "Поиск по ИНН не настроен — укажите ключ DaData в разделе «Интеграции → Реквизиты по ИНН»",
    };
  }
  return lookupPartyByInn(inn, apiKey);
}
