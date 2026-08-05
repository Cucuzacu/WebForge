/**
 * Downloads a file from a url and writes it to the CheerpJ filesystem.
 * @param {string} url
 * @param {string} destPath
 * @param {(downloadedBytes: number, totalBytes: number) => void} [progressCallback]
 * @returns {Promise<void>}
 */
async function downloadFileToCheerpJ(url, destPath, progressCallback) {
  const response = await fetch(url);
  const reader = response.body.getReader();
  const contentLength = +response.headers.get('Content-Length');

  const bytes = new Uint8Array(contentLength);
  progressCallback?.(0, contentLength);

  let pos = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, pos);
    pos += value.length;
    progressCallback?.(pos, contentLength);
  }

  await cheerpOSAddStringFile(destPath, bytes);
}

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: inline-block;
      aspect-ratio: 854 / 480;

      background: black;
      color: #eee;
      color-scheme: dark;

      width: 854px;
      height: 480px;
    }

    :host([hidden]) {
      display: none;
    }

    canvas {
      width: inherit;
      height: inherit;
    }

    .display {
      width: 854px;
      height: 480px;
      position: absolute;
      inset: 0;
      visibility: hidden;
    }

    .intro {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
    }

    p {
      max-width: 60ch;
    }

    .disclaimer {
      font-size: 0.8em;
      opacity: 0.5;
    }

    button {
      padding: 0.5em 1em;
      margin: 2em;
    }

    progress {
      width: calc(100% - 2em);
      margin: 1em;
    }

    *:focus {
      outline: none;
    }
  </style>
  <canvas width="854" height="480" tabindex="-1"></canvas>
  <div class="display"></div>
  <div class="intro">
    <button>Play!</button>
  </div>
  <progress style="display: none"></progress>
`;

export default class MinecraftClient extends HTMLElement {
  #canvas;
  #progress;
  #button;
  #display;
  #intro;
  #isRunning;

  constructor() {
    super();

    const shadowRoot = this.attachShadow({ mode: 'open' });
    shadowRoot.appendChild(template.content.cloneNode(true));

    this.#button = shadowRoot.querySelector('button');
    this.#button.addEventListener('click', () => this.run());

    this.#canvas = shadowRoot.querySelector('canvas');
    this.#canvas.width = 854;
    this.#canvas.height = 480;
    this.#canvas.tabIndex = -1;
    this.#canvas.style.display = 'none';

    this.#progress = shadowRoot.querySelector('progress');
    this.#progress.style.display = 'none';

    this.#intro = shadowRoot.querySelector('.intro');

    this.#display = shadowRoot.querySelector('.display');
    this.#display.setAttribute('style', 'width:100%;height:100%;position:absolute;top:0;left:0px;visibility:hidden;');
    cheerpjCreateDisplay(-1, -1, this.#display);

    this.#isRunning = false;
  }

  static register() {
    customElements.define('minecraft-client', this);
  }

  /** @returns {Promise<number>} Exit code */
  async run(username = "Player") {
    if (this.#isRunning) {
      throw new Error('Already running');
    }

    this.#intro.style.display = 'none';
    this.#progress.style.display = 'unset';

    const jarPath = "/str/client.jar";

    const mcJarUrl = new URL("mc.jar", import.meta.url).href;

    await downloadFileToCheerpJ(
      mcJarUrl,
      jarPath,
      (downloadedBytes, totalBytes) => {
        this.#progress.value = downloadedBytes;
        this.#progress.max = totalBytes;
      }
    );

    this.#progress.style.display = 'none';

    this.#canvas.style.display = 'unset';
    window.lwjglCanvasElement = this.#canvas;

    const exitCode = await cheerpjRunMain(
      "StupidForgeLauncher",
      `/app/minecraftforgelib.jar:/app/lwjgl-2.9.0.jar:/app/lwjgl_util-2.9.0.jar:${jarPath}`,
      "--username", username,
      "--session", "0",
      "--version", "1.6.4",
      "--gameDir", "/files/game",
      "--tweakClass", "cpw.mods.fml.common.launcher.FMLTweaker"
    );

    this.#canvas.style.display = 'none';
    this.#isRunning = false;

    return exitCode;
  }

  /** @returns {boolean} */
  get isRunning() {
    return this.#isRunning;
  }
}