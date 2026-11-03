import { PublicKey } from '@solana/web3.js';
import { fetchJson } from './util.js';

/** Reads the mint account on-chain and rejects dangerous settings. */
export async function checkMintOnChain(connection, mint, cfg) {
  const reasons = [];
  const info = await connection.getParsedAccountInfo(new PublicKey(mint), 'confirmed');
  const acc = info?.value;
  if (!acc) return { ok: false, reasons: ['mint account not found'] };
  const parsed = acc.data?.parsed;
  if (parsed?.type !== 'mint') return { ok: false, reasons: ['not a token mint'] };
  const i = parsed.info ?? {};

  if (cfg.requireNoMintAuthority && i.mintAuthority) reasons.push('mint authority active (dev can print tokens)');
  if (cfg.requireNoFreezeAuthority && i.freezeAuthority) reasons.push('freeze authority active (dev can freeze you)');

  // Token-2022 extensions that can trap or tax holders
  for (const ext of i.extensions ?? []) {
    const s = ext.state ?? {};
    switch (ext.extension) {
      case 'transferFeeConfig': {
        const bps = Math.max(
          Number(s.newerTransferFee?.transferFeeBasisPoints ?? 0),
          Number(s.olderTransferFee?.transferFeeBasisPoints ?? 0),
        );
        if (bps > 0) reasons.push(`transfer tax ${bps / 100}%`);
        break;
      }
      case 'permanentDelegate':
        if (s.delegate) reasons.push('permanent delegate (dev can take tokens)');
        break;
      case 'transferHook':
        if (s.programId) reasons.push('transfer hook');
        break;
      case 'nonTransferable':
        reasons.push('non-transferable');
        break;
      case 'defaultAccountState':
        if (String(s.accountState).toLowerCase() === 'frozen') reasons.push('accounts frozen by default');
        break;
      case 'pausableConfig':
        reasons.push('pausable token');
        break;
      default:
        break;
    }
  }
  return { ok: reasons.length === 0, reasons, decimals: i.decimals };
}

const SHIELD_BLOCK = /FREEZE|MINT_AUTHORITY|TRANSFER_FEE|TRANSFER_TAX|PERMANENT_DELEGATE|NOT_SELLABLE|HONEYPOT|NON_TRANSFERABLE|SCAM|RUG/i;

/** Jupiter Shield warnings -> blocking reasons. */
export function evaluateShield(warnings) {
  const block = [];
  const info = [];
  for (const w of warnings ?? []) {
    const type = String(w?.type ?? '');
    const sev = String(w?.severity ?? '').toLowerCase();
    if (sev === 'critical' || SHIELD_BLOCK.test(type)) block.push(type || w?.message || 'critical');
    else info.push(type);
  }
  return { ok: block.length === 0, reasons: block, info };
}

/** RugCheck.xyz summary report. Rejects any risk marked "danger". */
export async function checkRugcheck(mint) {
  const d = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { timeoutMs: 8000 });
  const risks = Array.isArray(d?.risks) ? d.risks : [];
  const danger = risks.filter((r) => String(r?.level ?? '').toLowerCase() === 'danger');
  return {
    ok: danger.length === 0,
    reasons: danger.map((r) => r?.name ?? 'danger'),
    warnings: risks.filter((r) => String(r?.level ?? '').toLowerCase() === 'warn').map((r) => r?.name),
    score: d?.score_normalised ?? d?.score ?? null,
  };
}
