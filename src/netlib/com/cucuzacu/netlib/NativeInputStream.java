package com.cucuzacu.netlib;

import java.io.InputStream;
import java.io.IOException;

public class NativeInputStream extends InputStream {
    private final NativeSocketBridge bridge;
    private boolean closed = false;
    private final byte[] oneByte = new byte[1];

    public NativeInputStream(NativeSocketBridge bridge) {
        this.bridge = bridge;
    }

    @Override
    public synchronized int read() throws IOException {
        int count = read(oneByte, 0, 1);
        return (count == -1) ? -1 : (oneByte[0] & 0xFF);
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (closed) throw new IOException("Stream closed");
        if (len == 0) return 0;
        return NativeSocketBridge.nativeRead(bridge.getFd(), b, off, len);
    }

    @Override
    public int available() throws IOException {
        if (closed) return 0;
        return NativeSocketBridge.nativeAvailable(bridge.getFd());
    }

    @Override
    public void close() throws IOException {
        if (!closed) {
            closed = true;
            NativeSocketBridge.nativeShutdownInput(bridge.getFd());
        }
    }
}