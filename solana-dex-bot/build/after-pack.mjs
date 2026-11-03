// electron-builder afterPack hook: sets the app icon and version info on the Windows .exe
// using pure JavaScript (no Wine/rcedit needed, so the exe can be built on Linux or macOS too).
import fs from 'node:fs';
import path from 'node:path';
import * as ResEdit from 'resedit';
import * as PELibrary from 'pe-library';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productFilename } = context.packager.appInfo;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const icoPath = path.join(context.packager.info.projectDir, 'build', 'icon.ico');

  const exe = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = PELibrary.NtExecutableResource.from(exe);

  // icon
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] ?? { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    target.id,
    target.lang,
    iconFile.icons.map((i) => i.data),
  );

  // version info
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const [major, minor, patch] = version.split('.').map((n) => Number.parseInt(n, 10) || 0);
    const lang = vi.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 };
    vi.setFileVersion(major, minor, patch, 0, lang.lang);
    vi.setProductVersion(major, minor, patch, 0, lang.lang);
    vi.setStringValues(lang, {
      ProductName: 'Solana Momentum Bot',
      FileDescription: 'Solana Momentum Bot',
      CompanyName: 'Solana Momentum Bot',
      LegalCopyright: `© ${new Date().getFullYear()}`,
      OriginalFilename: `${productFilename}.exe`,
      InternalName: productFilename,
    });
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • afterPack: icon + version info set on ${path.basename(exePath)}`);
}
