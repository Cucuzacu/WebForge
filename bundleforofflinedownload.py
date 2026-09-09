import os
import base64
import json
import re

def generate_offline_bundle():
    root_dir = os.getcwd()
    index_path = os.path.join(root_dir, "index.html")
    mc_web_path = os.path.join(root_dir, "minecraft-web.js")
    natives_dir = os.path.join(root_dir, "natives")

    with open(index_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    mc_web_content = ""
    if os.path.exists(mc_web_path):
        with open(mc_web_path, "r", encoding="utf-8") as f:
            mc_web_content = f.read()

    mc_web_content = mc_web_content.replace('import.meta.url', '"http://offline.local/minecraft-web.js"')

    mc_web_content = re.sub(
        r'(async\s+function\s+downloadFileToCheerpJ\s*\([^)]*\)\s*\{)',
        r'\1\n  const __fname = (arguments[0] || "").split("/").pop();\n'
        r'  if (typeof window.__OFFLINE_CACHE__ !== "undefined" && window.__OFFLINE_CACHE__.has(__fname)) {\n'
        r'    const __data = window.__OFFLINE_CACHE__.get(__fname);\n'
        r'    const __target = arguments[1] || arguments[0];\n'
        r'    cheerpOSAddStringFile(__target, __data);\n'
        r'    return;\n'
        r'  }\n',
        mc_web_content
    )

    offline_files = []

    if os.path.exists(natives_dir):
        for fname in sorted(os.listdir(natives_dir)):
            fpath = os.path.join(natives_dir, fname)
            if os.path.isfile(fpath):
                with open(fpath, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("utf-8")
                offline_files.append({
                    "path": f"/str/{fname}",
                    "data": b64
                })

    ignored_files = {"index.html", "webforge_offline.html", "minecraft-web.js"}
    ignored_exts = {".py", ".html"}

    for item in sorted(os.listdir(root_dir)):
        item_path = os.path.join(root_dir, item)
        if item in ignored_files or item == "natives":
            continue
        if os.path.isfile(item_path):
            ext = os.path.splitext(item)[1].lower()
            if ext in ignored_exts:
                continue
            with open(item_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")
            offline_files.append({
                "path": f"/str/{item}",
                "data": b64
            })

    files_json = json.dumps(offline_files)
    mc_web_json = json.dumps(mc_web_content)

    injected_js = f"""
      const OriginalURL = window.URL;
      window.URL = class extends OriginalURL {{
        constructor(url, base) {{
          let safeBase = base;
          if (!safeBase || (typeof safeBase === "string" && (safeBase.startsWith("blob:") || safeBase.includes("null")))) {{
            safeBase = "http://offline.local/";
          }}
          try {{
            super(url, safeBase);
          }} catch (e) {{
            super(url, "http://offline.local/");
          }}
        }}
      }};
      Object.assign(window.URL, OriginalURL);

      function base64ToUint8Array(base64) {{
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {{
          bytes[i] = binaryString.charCodeAt(i);
        }}
        return bytes;
      }}

      const OFFLINE_FILES = {files_json};
      window.__OFFLINE_CACHE__ = new Map();

      for (const file of OFFLINE_FILES) {{
        const bytes = base64ToUint8Array(file.data);
        const filename = file.path.split("/").pop();
        window.__OFFLINE_CACHE__.set(file.path, bytes);
        window.__OFFLINE_CACHE__.set(filename, bytes);
      }}

      const originalFetch = window.fetch;
      window.fetch = async function(input, init) {{
        const urlStr = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
        for (const [key, bytes] of window.__OFFLINE_CACHE__.entries()) {{
          if (urlStr.endsWith(key)) {{
            return new Response(bytes, {{
              status: 200,
              headers: {{
                "Content-Type": "application/octet-stream",
                "Content-Length": bytes.byteLength.toString()
              }}
            }});
          }}
        }}
        return originalFetch.apply(this, arguments);
      }};

      function downloadFileToCheerpJ_offline(strPath, base64Data) {{
        const uint8Array = base64ToUint8Array(base64Data);
        cheerpOSAddStringFile(strPath, uint8Array);
      }}

      const minecraftWebCode = {mc_web_json};
      const minecraftWebBlob = new Blob([minecraftWebCode], {{ type: "application/javascript" }});
      const minecraftWebUrl = OriginalURL.createObjectURL(minecraftWebBlob);
      const minecraftWebModule = await import(minecraftWebUrl);
      const MinecraftClient = minecraftWebModule.default || minecraftWebModule.MinecraftClient || minecraftWebModule;
"""

    html_content = re.sub(r'import\s+MinecraftClient\s+from\s+["\']./minecraft-web\.js["\'];?', '', html_content)

    html_content = html_content.replace(
        'const nativesPath = `/app${new URL("natives", import.meta.url).pathname}`;',
        ''
    )
    html_content = html_content.replace(
        '`java.library.path=${nativesPath}`',
        '"java.library.path=/str"'
    )

    html_content = html_content.replace(
        'await cheerpjInit({',
        f'{injected_js}\n      await cheerpjInit({{'\
    )

    post_init_code = """
      for (const file of OFFLINE_FILES) {
        downloadFileToCheerpJ_offline(file.path, file.data);
      }
"""
    html_content = html_content.replace(
        'const lib = await cheerpjRunLibrary("");',
        f'{post_init_code}\n      const lib = await cheerpjRunLibrary("");'
    )

    post_lib_code = """
      const initFiles = await lib.java.nio.file.Files;
      const initPaths = await lib.java.nio.file.Paths;
      const initCopyOption = await lib.java.nio.file.StandardCopyOption;

      for (const file of OFFLINE_FILES) {
        try {
          const srcPath = file.path;
          const filename = srcPath.replace("/str/", "");
          const appTarget = await initPaths.get(`/app/${filename}`);
          await initFiles.createDirectories(appTarget.getParent());
          await initFiles.copy(await initPaths.get(srcPath), appTarget, [initCopyOption.REPLACE_EXISTING]);

          if (filename === "lwjgl.js" || filename === "jawt.js") {
            const nativeTarget = await initPaths.get(`/app/natives/${filename}`);
            await initFiles.createDirectories(nativeTarget.getParent());
            await initFiles.copy(await initPaths.get(srcPath), nativeTarget, [initCopyOption.REPLACE_EXISTING]);
          }
        } catch (err) {
          console.warn("fs pre-copy notice:", err);
        }
      }
"""
    html_content = html_content.replace(
        'const lib = await cheerpjRunLibrary("");',
        f'const lib = await cheerpjRunLibrary("");\n{post_lib_code}'
    )

    out_path = os.path.join(root_dir, "webforge_offline.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"generated offline html: {out_path}")

if __name__ == "__main__":
    generate_offline_bundle()