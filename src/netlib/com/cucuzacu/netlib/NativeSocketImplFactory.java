package com.cucuzacu.netlib;

import java.net.SocketImpl;
import java.net.SocketImplFactory;

public class NativeSocketImplFactory implements SocketImplFactory {
    @Override
    public SocketImpl createSocketImpl() {
        return new NativeSocketImpl();
    }
}