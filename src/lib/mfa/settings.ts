import { prisma } from "@/lib/db";
import { parseMfaPolicy, type MfaPolicy } from "@/lib/mfa/policy";

const POLICY_KEY = "mfa_policy";

export async function getMfaPolicy(): Promise<MfaPolicy> {
  const row = await prisma.appSetting.findUnique({ where: { key: POLICY_KEY } });
  return parseMfaPolicy(row?.value);
}

export async function setMfaPolicy(policy: MfaPolicy): Promise<void> {
  await prisma.appSetting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, value: policy }, update: { value: policy } });
}
