import os, zipfile, sys

src = r"D:\WebCodingRepo\live2d-stage\dist\大肥鱼Live2d桌宠-发布版-win32-x64"
dst = r"D:\WebCodingRepo\live2d-stage\release\大肥鱼Live2d桌宠-v1.0.0-win32-x64.zip"
prefix = "大肥鱼Live2d桌宠-v1.0.0-win32-x64"

if os.path.exists(dst):
    os.remove(dst)

count = 0
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, dirs, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, src)
            arc = prefix + "/" + rel.replace(os.sep, "/")
            z.write(p, arc)
            count += 1

print("entries:", count)
print("size MB:", round(os.path.getsize(dst) / 1048576, 1))
