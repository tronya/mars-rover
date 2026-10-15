// Geometry fingerprint of a built vehicle: mesh count, total vertices, and the
// bounding box — enough to tell whether a refactor changed what gets built.
import * as THREE from 'three';
export function fingerprint(v) {
  let meshes = 0, verts = 0;
  v.root.updateMatrixWorld(true);
  v.root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    verts += (o.geometry.attributes.position?.count || 0) * (o.isInstancedMesh ? o.count : 1);
  });
  const b = new THREE.Box3().setFromObject(v.root);
  const r = (n) => Math.round(n * 1000) / 1000;
  return { meshes, verts, wheels: v.wheels.length, min: b.min.toArray().map(r), max: b.max.toArray().map(r) };
}
