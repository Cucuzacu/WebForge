// netlib.js
// made by cucuzacu in 2026

const sockets = new Map();
let nextFd = 1;

function formatWssUrl(host, port)
{
    let cleanHost = String(host);
    if (cleanHost.includes("://")) {
        cleanHost = cleanHost.substring(cleanHost.indexOf("://") + 3);
    }
    if (!cleanHost.startsWith("wss://") && !cleanHost.startsWith("ws://")) {
        if (port > 0 && !cleanHost.includes(":")) {
            cleanHost = `${cleanHost}:${port}`;
        }
        return `wss://${cleanHost}`;
    }
    return cleanHost;
}

function copyToBuffer(lib, dstObj, offset, srcUint8Array)
{
    if (dstObj instanceof Uint8Array || (typeof dstObj === "object" && dstObj !== null && dstObj.subarray)) {
        dstObj.set(srcUint8Array, offset);
        return;
    }
    var v = (lib && typeof lib.getJNIDataView === "function") ? lib.getJNIDataView() : null;
    var ptr = Number(dstObj);
    if (v && ptr) {
        new Uint8Array(v.buffer, v.byteOffset + ptr + offset, srcUint8Array.length).set(srcUint8Array);
    } else if (dstObj) {
        dstObj.set(srcUint8Array, offset);
    }
}

function copyFromBuffer(lib, srcObj, offset, len)
{
    if (srcObj instanceof Uint8Array) {
        return srcObj.subarray(offset, offset + len);
    }
    if (typeof srcObj === "object" && srcObj !== null && srcObj.subarray) {
        return new Uint8Array(srcObj.subarray(offset, offset + len));
    }
    var v = (lib && typeof lib.getJNIDataView === "function") ? lib.getJNIDataView() : null;
    var ptr = Number(srcObj);
    if (v && ptr) {
        return new Uint8Array(v.buffer, v.byteOffset + ptr + offset, len).slice();
    }
    return new Uint8Array(srcObj.subarray ? srcObj.subarray(offset, offset + len) : len);
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeCreate(lib, stream)
{
    const fd = nextFd++;
    sockets.set(fd, {
        ws: null,
        stream: Boolean(stream),
        receiveQueue: [],
        waiters: [],
        options: {},
        bufferedBytes: 0,
        connected: false,
        closed: false,
        inputShutdown: false,
        outputShutdown: false,
        error: null
    });
    return fd;
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeConnect(lib, fd, host, port, timeout)
{
    const sock = sockets.get(fd);
    if (!sock) throw new Error("Invalid socket descriptor");

    const url = formatWssUrl(host, port);

    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket(url);
            ws.binaryType = "arraybuffer";
            sock.ws = ws;

            let timeoutId = null;
            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    ws.close();
                    reject(new Error(`Connection timed out after ${timeout}ms`));
                }, timeout);
            }

            ws.onopen = () => {
                if (timeoutId) clearTimeout(timeoutId);
                sock.connected = true;
                resolve();
            };

            ws.onmessage = (event) => {
                if (sock.inputShutdown) return;
                let data;
                if (event.data instanceof ArrayBuffer) {
                    data = new Uint8Array(event.data);
                } else if (typeof event.data === "string") {
                    data = new TextEncoder().encode(event.data);
                }
                if (data && data.length > 0) {
                    sock.receiveQueue.push(data);
                    sock.bufferedBytes += data.length;
                    if (sock.waiters.length > 0) {
                        const waiter = sock.waiters.shift();
                        waiter();
                    }
                }
            };

            ws.onerror = (err) => {
                if (timeoutId) clearTimeout(timeoutId);
                sock.error = err;
                if (!sock.connected) {
                    reject(new Error("WebSocket connection failed"));
                }
            };

            ws.onclose = () => {
                if (timeoutId) clearTimeout(timeoutId);
                sock.connected = false;
                sock.closed = true;
                while (sock.waiters.length > 0) {
                    const waiter = sock.waiters.shift();
                    waiter();
                }
            };
        } catch (e) {
            reject(e);
        }
    });
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeRead(lib, fd, b, off, len)
{
    const sock = sockets.get(fd);
    if (!sock) throw new Error("Invalid socket descriptor");
    if (sock.inputShutdown) return -1;
    if (len === 0) return 0;

    const readFromQueue = () => {
        if (sock.receiveQueue.length === 0) {
            return sock.closed ? -1 : null;
        }
        const chunk = sock.receiveQueue.shift();
        const readLen = Math.min(len, chunk.length);
        const toRead = chunk.subarray(0, readLen);
        copyToBuffer(lib, b, off, toRead);

        if (chunk.length > readLen) {
            sock.receiveQueue.unshift(chunk.subarray(readLen));
        }
        sock.bufferedBytes -= readLen;
        return readLen;
    };

    if (sock.receiveQueue.length > 0) {
        return readFromQueue();
    }

    if (sock.closed) return -1;

    return new Promise((resolve) => {
        sock.waiters.push(() => {
            const res = readFromQueue();
            resolve(res !== null ? res : -1);
        });
    });
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeWrite(lib, fd, b, off, len)
{
    const sock = sockets.get(fd);
    if (!sock || !sock.ws) throw new Error("Invalid or unconnected socket");
    if (sock.outputShutdown || sock.closed) throw new Error("Socket output is closed");

    const bytes = copyFromBuffer(lib, b, off, len);
    sock.ws.send(bytes);
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeAvailable(lib, fd)
{
    const sock = sockets.get(fd);
    if (!sock || sock.inputShutdown) return 0;
    return Math.max(0, sock.bufferedBytes);
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeClose(lib, fd)
{
    const sock = sockets.get(fd);
    if (!sock) return;

    sock.closed = true;
    sock.connected = false;
    if (sock.ws) {
        sock.ws.close();
    }
    while (sock.waiters.length > 0) {
        const waiter = sock.waiters.shift();
        waiter();
    }
    sockets.delete(fd);
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeShutdownInput(lib, fd)
{
    const sock = sockets.get(fd);
    if (sock) {
        sock.inputShutdown = true;
        sock.receiveQueue = [];
        while (sock.waiters.length > 0) {
            const waiter = sock.waiters.shift();
            waiter();
        }
    }
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeShutdownOutput(lib, fd)
{
    const sock = sockets.get(fd);
    if (sock) {
        sock.outputShutdown = true;
    }
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeBind(lib, fd, host, port)
{
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeListen(lib, fd, backlog)
{
    throw new Error("server sockets (listen) are not supported in netlib");
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeAccept(lib, serverFd, targetImpl)
{
    throw new Error("server sockets (accept) are not supported in netlib");
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeSetOption(lib, fd, optID, value)
{
    const sock = sockets.get(fd);
    if (sock) sock.options[optID] = value;
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeGetOption(lib, fd, optID)
{
    const sock = sockets.get(fd);
    return sock ? (sock.options[optID] ?? null) : null;
}

function Java_com_cucuzacu_netlib_NativeSocketBridge_nativeSendUrgentData(lib, fd, data)
{
    const sock = sockets.get(fd);
    if (sock && sock.ws && sock.connected) sock.ws.send(new Uint8Array([data & 0xFF]));
}

export default {
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeCreate,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeConnect,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeBind,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeListen,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeAccept,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeRead,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeWrite,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeAvailable,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeClose,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeShutdownInput,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeShutdownOutput,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeSetOption,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeGetOption,
    Java_com_cucuzacu_netlib_NativeSocketBridge_nativeSendUrgentData
};