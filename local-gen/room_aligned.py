"""Room-aligned top-down map: u = depth along the room axis (yaw deg), v = lateral. Prints walls per u."""
import sys
import numpy as np
sys.argv += [] 
exec(open("room_walls.py").read().split("core =")[0])
yaw = np.radians(float(sys.argv[2]) if len(sys.argv) > 2 else 22)
f = np.array([np.sin(yaw), -np.cos(yaw)]); r = np.array([np.cos(yaw), np.sin(yaw)])
U = S[:, 0] * f[0] + S[:, 2] * f[1]; V = S[:, 0] * r[0] + S[:, 2] * r[1]
m = (S[:, 1] > 0.6) & (S[:, 1] < 2.0)
H, _, _ = np.histogram2d(U[m], V[m], bins=[np.arange(-3, 14.01, 0.25), np.arange(-7, 4.01, 0.25)])
ramp = " .:-=+*#%@"
print("v: -7" + " " * 26 + "0" + " " * 14 + "+4")
for i, row in enumerate(H):
    print(f"u{-3 + i * 0.25:6.2f} " + "".join(ramp[min(9, int(np.log1p(x) * 1.6))] for x in row))
for u0 in range(-2, 13):
    sl = m & (np.abs(U - u0) < 0.3)
    vs = V[sl]
    if len(vs) > 50:
        print(f"u {u0:+3d}: walls v {np.percentile(vs, 1.5):+.2f} .. {np.percentile(vs, 98.5):+.2f}")
