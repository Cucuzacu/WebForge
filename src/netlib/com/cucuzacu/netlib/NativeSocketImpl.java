package com.cucuzacu.netlib;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.*;

public class NativeSocketImpl extends SocketImpl {

    private NativeSocketBridge bridge;
    private NativeInputStream in;
    private NativeOutputStream out;
    private int timeout = 0;

    public NativeSocketImpl() {}

    @Override
    protected void create(boolean stream) throws IOException {
        int fdVal = NativeSocketBridge.nativeCreate(stream);
        this.bridge = new NativeSocketBridge(fdVal);
        this.in = new NativeInputStream(bridge);
        this.out = new NativeOutputStream(bridge);
    }

    @Override
    protected void connect(String host, int port) throws IOException {
        connect(new InetSocketAddress(host, port), timeout);
    }

    @Override
    protected void connect(InetAddress address, int port) throws IOException {
        connect(new InetSocketAddress(address, port), timeout);
    }

    @Override
    protected void connect(SocketAddress endpoint, int timeout) throws IOException {
        if (!(endpoint instanceof InetSocketAddress)) {
            throw new IllegalArgumentException("Unsupported address type");
        }
        InetSocketAddress inetAddr = (InetSocketAddress) endpoint;
        String host = inetAddr.getHostString();
        int port = inetAddr.getPort();

        this.address = inetAddr.getAddress();
        this.port = port;

        NativeSocketBridge.nativeConnect(bridge.getFd(), host, port, timeout);
    }

    @Override
    protected void bind(InetAddress host, int port) throws IOException {
        this.localport = port;
        NativeSocketBridge.nativeBind(bridge.getFd(), host.getHostAddress(), port);
    }

    @Override
    protected void listen(int backlog) throws IOException {
        NativeSocketBridge.nativeListen(bridge.getFd(), backlog);
    }

    @Override
    protected void accept(SocketImpl s) throws IOException {
        if (!(s instanceof NativeSocketImpl)) {
            throw new IllegalArgumentException("Target SocketImpl must be NativeSocketImpl");
        }
        NativeSocketImpl target = (NativeSocketImpl) s;
        int clientFd = NativeSocketBridge.nativeAccept(bridge.getFd(), target);
        target.bridge = new NativeSocketBridge(clientFd);
        target.in = new NativeInputStream(target.bridge);
        target.out = new NativeOutputStream(target.bridge);
    }

    @Override
    protected InputStream getInputStream() throws IOException {
        return in;
    }

    @Override
    protected OutputStream getOutputStream() throws IOException {
        return out;
    }

    @Override
    protected int available() throws IOException {
        return in.available();
    }

    @Override
    protected void close() throws IOException {
        if (bridge != null) {
            NativeSocketBridge.nativeClose(bridge.getFd());
        }
    }

    @Override
    protected void sendUrgentData(int data) throws IOException {
        NativeSocketBridge.nativeSendUrgentData(bridge.getFd(), data);
    }

    @Override
    public void setOption(int optID, Object value) throws SocketException {
        if (optID == SocketOptions.SO_TIMEOUT) {
            this.timeout = (Integer) value;
        }
        try {
            NativeSocketBridge.nativeSetOption(bridge.getFd(), optID, value);
        } catch (IOException e) {
            SocketException se = new SocketException("Failed to set option: " + optID);
            se.initCause(e);
            throw se;
        }
    }

    @Override
    public Object getOption(int optID) throws SocketException {
        try {
            return NativeSocketBridge.nativeGetOption(bridge.getFd(), optID);
        } catch (IOException e) {
            SocketException se = new SocketException("Failed to get option: " + optID);
            se.initCause(e);
            throw se;
        }
    }
}