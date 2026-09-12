package com.cucuzacu.netlib;

import java.io.IOException;

public class NativeSocketBridge {

    static {
        System.loadLibrary("netlib");
    }

    private final int fd;

    public NativeSocketBridge(int fd) {
        this.fd = fd;
    }

    public int getFd() {
        return fd;
    }

    public static native int nativeCreate(boolean stream) throws IOException;
    public static native void nativeConnect(int fd, String host, int port, int timeout) throws IOException;
    public static native void nativeBind(int fd, String host, int port) throws IOException;
    public static native void nativeListen(int fd, int backlog) throws IOException;
    public static native int nativeAccept(int serverFd, NativeSocketImpl targetImpl) throws IOException;
    
    public static native int nativeRead(int fd, byte[] b, int off, int len) throws IOException;
    public static native void nativeWrite(int fd, byte[] b, int off, int len) throws IOException;
    public static native int nativeAvailable(int fd) throws IOException;
    public static native void nativeClose(int fd) throws IOException;
    
    public static native void nativeShutdownInput(int fd) throws IOException;
    public static native void nativeShutdownOutput(int fd) throws IOException;
    
    public static native void nativeSetOption(int fd, int optID, Object value) throws IOException;
    public static native Object nativeGetOption(int fd, int optID) throws IOException;
    public static native void nativeSendUrgentData(int fd, int data) throws IOException;
}