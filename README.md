# WebForge



WebForge is a port of Minecraft 1.6.4 forge to the web browser. It can load simple mods, such as [this](https://www.curseforge.com/minecraft/mc-mods/sprinting-key), but also more complex ones such as the Aether II.



To compile the offline download: run ```python3 bundleforofflinedownload.py```. Download the precompiled offline download from the [Releases section](https://github.com/Cucuzacu/WebForge/releases/latest).



Yep, that's all I have to say. Words can't explain what a demo can! Play it [here](https://cucuzacu.github.io/WebForge).



Join the [Discord server](https://discord.gg/QCAEMtnqws).

## Multiplayer

Navigate to the `src/wssproxy` directory. Run `javac WssProxy.java`, then run `java WssProxy <server ip> <server port> <wss port, optional>`. It will tell you the wss:// ip (put that in WebForge WITHOUT the wss://) and a https:// website that you should visit in your browser before connecting to the server in WebForge.
This will eventually change, multiplayer is still in testing.