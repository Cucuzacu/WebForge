// simple cheerpj networking lib
// made by cucuzacu in 2026

package com.cucuzacu.netlib;

import java.net.Socket;
import java.net.ServerSocket;

public class NetLib {

    private static boolean initialized = false;

    public synchronized static void init() {
        if (initialized) return;

        try {
            NativeSocketImplFactory factory = new NativeSocketImplFactory();
            
            Socket.setSocketImplFactory(factory);
            ServerSocket.setSocketFactory(factory);

            initialized = true;
            System.out.println("[NetLib] NetLib installed successfully.");
        } catch (Exception e) {
            throw new RuntimeException("[NetLib] Failed to install NetLib.", e);
        }
    }
}