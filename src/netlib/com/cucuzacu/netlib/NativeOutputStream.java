package com.cucuzacu.netlib;

import java.io.OutputStream;
import java.io.IOException;

public class NativeOutputStream extends OutputStream {
    private final NativeSocketBridge bridge;
    private boolean closed = false;
    private final byte[] oneByte = new byte[1];

    public NativeOutputStream(NativeSocketBridge bridge) {
        this.bridge = bridge;
    }

    public synchronized void write(int b) throws IOException {
        oneByte[0] = (byte) b;
        write(oneByte, 0, 1);
    }

    @Override
    public void write(byte[] b, int off, int len) throws IOException {
        if (closed) throw new IOException("Stream closed");
        NativeSocketBridge.nativeWrite(bridge.getFd(), b, off, len);
    }

    @Override
    public void close() throws IOException {
        if (!closed) {
            closed = true;
            NativeSocketBridge.nativeShutdownOutput(bridge.getFd());
        }
    }
}