import java.io.File;
import com.cucuzacu.netlib.NetLib;

public class StupidForgeLauncher {
    public static void main(String[] args) {
        boolean created = false;

	NetLib.init();

        File gameDir = new File("game");
        if (!gameDir.exists()) {
            created = gameDir.mkdirs();
            if (created) System.out.println("[StupidForgeLauncher] Created directory: " + gameDir.getAbsolutePath());
        }

        try {
            net.minecraft.launchwrapper.Launch.main(args);
        } catch (Exception e) {
            System.err.println("[StupidForgeLauncher] Failed to invoke Launchwrapper. It is probably your fault:");
            e.printStackTrace();
        }
    }
}