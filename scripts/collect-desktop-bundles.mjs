import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const bundleRoot = path.join(repoRoot, "apps/desktop/src-tauri/target/release/bundle");
const outputRoot = path.join(repoRoot, "artifacts", "desktop");
const platform = process.env.TRACKIFY_DESKTOP_PLATFORM || process.platform;
const gitSha = process.env.GITHUB_SHA || process.env.TRACKIFY_GIT_SHA || "local-working-tree";
const artifactExtensions = [".dmg", ".msi", ".exe", ".appimage", ".deb", ".rpm", ".zip", ".gz"];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(targetPath) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const nextPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(nextPath)));
    } else if (entry.isFile()) {
      results.push(nextPath);
    }
  }
  return results.sort();
}

async function walkArtifactPaths(targetPath) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absolutePath = path.join(targetPath, entry.name);
    const lowerName = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      if (lowerName.endsWith(".app")) {
        results.push(absolutePath);
        continue;
      }
      if (entry.name === "share") {
        continue;
      }
      results.push(...(await walkArtifactPaths(absolutePath)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.startsWith("rw.")) continue;
    if (artifactExtensions.some((extension) => lowerName.endsWith(extension))) {
      results.push(absolutePath);
    }
  }

  return results.sort();
}

async function sha256File(filePath) {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function digestArtifact(targetPath) {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) {
    const fileHash = await sha256File(targetPath);
    return {
      type: "file",
      size: stat.size,
      sha256: fileHash,
      files: [
        {
          path: path.basename(targetPath),
          size: stat.size,
          sha256: fileHash,
        },
      ],
    };
  }

  const files = await walkFiles(targetPath);
  const fileDigests = [];
  const combined = createHash("sha256");
  let totalSize = 0;

  for (const filePath of files) {
    const relativePath = path.relative(targetPath, filePath).split(path.sep).join("/");
    const statEntry = await fs.stat(filePath);
    const fileHash = await sha256File(filePath);
    totalSize += statEntry.size;
    fileDigests.push({
      path: relativePath,
      size: statEntry.size,
      sha256: fileHash,
    });
    combined.update(`${relativePath}\0${fileHash}\0${statEntry.size}\n`);
  }

  return {
    type: "directory",
    size: totalSize,
    sha256: combined.digest("hex"),
    files: fileDigests,
  };
}

async function main() {
  if (!(await pathExists(bundleRoot))) {
    throw new Error(`Bundle root not found: ${bundleRoot}`);
  }

  const artifactPaths = await walkArtifactPaths(bundleRoot);
  const artifacts = [];

  for (const absolutePath of artifactPaths) {
    const digest = await digestArtifact(absolutePath);
    artifacts.push({
      name: path.basename(absolutePath),
      relativePath: path.relative(repoRoot, absolutePath).split(path.sep).join("/"),
      ...digest,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    gitSha,
    platform,
    bundleRoot: path.relative(repoRoot, bundleRoot).split(path.sep).join("/"),
    artifactCount: artifacts.length,
    artifacts,
  };

  const destinationDir = path.join(outputRoot, platform);
  await fs.mkdir(destinationDir, { recursive: true });
  await fs.writeFile(path.join(destinationDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(
    path.join(destinationDir, "checksums.txt"),
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.relativePath}`).join("\n")}\n`,
  );

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

await main();
