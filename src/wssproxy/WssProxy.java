import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class WssProxy {

    private static final int DEFAULT_WSS_PORT = 25565;
    private static final int FALLBACK_WSS_PORT = 8080;

    public static void main(String[] args) {
        if (args.length < 2) {
            System.out.println("Usage: java WssProxy <mc_target_ip> <mc_target_port> [wss_port]");
            return;
        }

        String targetIp = args[0];
        int targetPort = Integer.parseInt(args[1]);
        int preferredWssPort = (args.length >= 3) ? Integer.parseInt(args[2]) : DEFAULT_WSS_PORT;

        SSLServerSocket serverSocket = createSSLServerSocket(preferredWssPort);
        int boundPort = preferredWssPort;

        if (serverSocket == null && preferredWssPort != FALLBACK_WSS_PORT) {
            System.out.println("[WssProxy] Port " + preferredWssPort + " is unavailable. Falling back to port " + FALLBACK_WSS_PORT + "...");
            serverSocket = createSSLServerSocket(FALLBACK_WSS_PORT);
            boundPort = FALLBACK_WSS_PORT;
        }

        if (serverSocket == null) {
            System.out.println("[WssProxy] Port " + FALLBACK_WSS_PORT + " is also unavailable. Binding to auto-assigned port...");
            serverSocket = createSSLServerSocket(0);
            if (serverSocket != null) {
                boundPort = serverSocket.getLocalPort();
            }
        }

        if (serverSocket == null) {
            System.err.println("[WssProxy] Error: Could not bind to any port.");
            return;
        }

        System.out.println("[WssProxy] Proxy active!");
        System.out.println("[WssProxy] Listening on : wss://localhost:" + boundPort);
        System.out.println("[WssProxy] Target Server: " + targetIp + ":" + targetPort);
	System.out.println("[WssProxy] Go to : https://localhost:" + boundPort + " to verify the certificate.");

        while (true) {
            try {
                Socket wsClient = serverSocket.accept();
                new Thread(() -> handleClient(wsClient, targetIp, targetPort)).start();
            } catch (IOException e) {
                System.err.println("[WssProxy] Connection accept error: " + e.getMessage());
            }
        }
    }

    private static SSLServerSocket createSSLServerSocket(int port) {
        try {
            SSLContext sslContext = getOrCreateSSLContext();
            SSLServerSocketFactory factory = sslContext.getServerSocketFactory();
            return (SSLServerSocket) factory.createServerSocket(port);
        } catch (BindException e) {
            return null;
        } catch (Exception e) {
            System.err.println("[WssProxy] SSL initialization failed: " + e.getMessage());
            return null;
        }
    }

    private static SSLContext getOrCreateSSLContext() throws Exception {
        File ksFile = new File("keystore.jks");
        if (!ksFile.exists()) {
            System.out.println("[WssProxy] Generating keystore.jks...");
            ProcessBuilder pb = new ProcessBuilder(
                    "keytool", "-genkeypair",
                    "-alias", "mcwss",
                    "-keyalg", "RSA",
                    "-keysize", "2048",
                    "-keystore", "keystore.jks",
                    "-storepass", "password",
                    "-keypass", "password",
                    "-dname", "CN=localhost",
                    "-validity", "365"
            );
            pb.inheritIO();
            Process p = pb.start();
            if (p.waitFor() != 0) {
                throw new RuntimeException("Failed to generate keystore using keytool.");
            }
        }

        KeyStore ks = KeyStore.getInstance("JKS");
        try (FileInputStream fis = new FileInputStream(ksFile)) {
            ks.load(fis, "password".toCharArray());
        }

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, "password".toCharArray());

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(kmf.getKeyManagers(), null, null);
        return context;
    }

    private static void handleClient(Socket wsSocket, String targetIp, int targetPort) {
        try (InputStream wsIn = wsSocket.getInputStream();
             OutputStream wsOut = wsSocket.getOutputStream()) {

            if (!performHandshake(wsIn, wsOut)) {
                return;
            }

            try (Socket mcSocket = new Socket(targetIp, targetPort);
                 InputStream mcIn = mcSocket.getInputStream();
                 OutputStream mcOut = mcSocket.getOutputStream()) {

                Thread mcToWs = new Thread(() -> {
                    try {
                        byte[] buffer = new byte[8192];
                        int len;
                        while ((len = mcIn.read(buffer)) != -1) {
                            sendWsFrame(wsOut, 0x2, buffer, 0, len);
                        }
                    } catch (IOException ignored) {
                    } finally {
                        closeQuietly(wsSocket);
                    }
                });
                mcToWs.start();

                while (!wsSocket.isClosed()) {
                    int b1 = wsIn.read();
                    if (b1 == -1) break;
                    int b2 = wsIn.read();
                    if (b2 == -1) break;

                    int opcode = b1 & 0x0F;
                    boolean masked = (b2 & 0x80) != 0;
                    long payloadLen = b2 & 0x7F;

                    if (opcode == 0x8) break;

                    if (payloadLen == 126) {
                        payloadLen = ((wsIn.read() & 0xFF) << 8) | (wsIn.read() & 0xFF);
                    } else if (payloadLen == 127) {
                        payloadLen = 0;
                        for (int i = 0; i < 8; i++) {
                            payloadLen = (payloadLen << 8) | (wsIn.read() & 0xFF);
                        }
                    }

                    byte[] mask = new byte[4];
                    if (masked) {
                        readFully(wsIn, mask);
                    }

                    byte[] payload = new byte[(int) payloadLen];
                    readFully(wsIn, payload);

                    if (masked) {
                        for (int i = 0; i < payload.length; i++) {
                            payload[i] ^= mask[i % 4];
                        }
                    }

                    if (opcode == 0x1 || opcode == 0x2 || opcode == 0x0) {
                        mcOut.write(payload);
                        mcOut.flush();
                    } else if (opcode == 0x9) {
                        sendWsFrame(wsOut, 0x0A, payload, 0, payload.length);
                    }
                }
            }

        } catch (Exception ignored) {
        } finally {
            closeQuietly(wsSocket);
        }
    }

    private static boolean performHandshake(InputStream in, OutputStream out) throws Exception {
        ByteArrayOutputStream headerBuf = new ByteArrayOutputStream();
        int state = 0;
        while (true) {
            int b = in.read();
            if (b == -1) return false;
            headerBuf.write(b);
            if (state == 0 && b == '\r') state = 1;
            else if (state == 1 && b == '\n') state = 2;
            else if (state == 2 && b == '\r') state = 3;
            else if (state == 3 && b == '\n') break;
            else state = (b == '\r') ? 1 : 0;
        }

        String headers = headerBuf.toString(StandardCharsets.UTF_8);
        String secKey = null;
        for (String line : headers.split("\r\n")) {
            if (line.toLowerCase().startsWith("sec-websocket-key:")) {
                secKey = line.substring(18).trim();
            }
        }

        if (secKey == null) {
            String html = "<html><body style='font-family:sans-serif;text-align:center;padding-top:50px;'>" +
                    "<h1>WSS Proxy is Active</h1>" +
                    "<p>SSL Certificate successfully accepted! You can close this tab and run WebForge.</p>" +
                    "</body></html>";
            String httpResponse = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: text/html\r\n" +
                    "Content-Length: " + html.getBytes(StandardCharsets.UTF_8).length + "\r\n" +
                    "Connection: close\r\n\r\n" + html;
            out.write(httpResponse.getBytes(StandardCharsets.UTF_8));
            out.flush();
            return false;
        }

        String acceptKey = Base64.getEncoder().encodeToString(
                MessageDigest.getInstance("SHA-1").digest(
                        (secKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.UTF_8)
                )
        );

        String response = "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n";

        out.write(response.getBytes(StandardCharsets.UTF_8));
        out.flush();
        return true;
    }

    private static synchronized void sendWsFrame(OutputStream out, int opcode, byte[] data, int off, int len) throws IOException {
        out.write(0x80 | (opcode & 0x0F));
        if (len < 126) {
            out.write(len);
        } else if (len <= 65535) {
            out.write(126);
            out.write((len >> 8) & 0xFF);
            out.write(len & 0xFF);
        } else {
            out.write(127);
            for (int i = 56; i >= 0; i -= 8) {
                out.write((int) (len >> i) & 0xFF);
            }
        }
        out.write(data, off, len);
        out.flush();
    }

    private static void readFully(InputStream in, byte[] b) throws IOException {
        int read = 0;
        while (read < b.length) {
            int count = in.read(b, read, b.length - read);
            if (count == -1) throw new EOFException();
            read += count;
        }
    }

    private static void closeQuietly(Socket socket) {
        try {
            if (socket != null && !socket.isClosed()) socket.close();
        } catch (IOException ignored) {}
    }
}