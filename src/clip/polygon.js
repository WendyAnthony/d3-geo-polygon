import clip from "./index";
import {atan2, cos, degrees, max, min, pi, radians, sign, sin, sqrt} from "../math";
import {cartesian, cartesianCross, cartesianDot, cartesianEqual, spherical} from "../cartesian";
import {intersectCoincident, intersectPointOnLine, intersectSegment, intersect} from "../intersect";
import {default as polygonContains} from "../polygonContains";

var clipNone = function(stream) { return stream; };

// clipPolygon
export default function (p) {
  var segments = [];

  if (p.type != "Polygon") return clipNone; // todo: MultiPolygon?

  var polygon = p.coordinates.map(function(ring) {
    var c, c0;
    ring = ring.map(function(point, i) {
      c = cartesian(point = [point[0] * radians, point[1] * radians]);
      if (i) segments.push(new intersectSegment(c0, c));
      c0 = c;
      return point;
    });
    ring.pop();
    return ring;
  });


  function visible(lambda, phi) {
    return polygonContains(polygon, [lambda, phi]);
  }

  function randsign(i,j) {
    return sign(sin(100 * i + j));
  }

  function clipLine(stream) {
    var point0,
        lambda00,
        phi00,
        v00,
        v0,
        clean;
    return {
      lineStart: function() {
        point0 = null;
        clean = 1;
      },
      point: function(lambda, phi, close) {
        if (cos(lambda) == -1) lambda -= sign(sin(lambda)) * 1e-5; // move away from -180/180 https://github.com/d3/d3-geo/pull/108#issuecomment-323798937
        if (close) lambda = lambda00, phi = phi00;
        var point = cartesian([lambda, phi]),
            v = v0,
            intersection,
            i, j, s, t;
        if (point0) {
          var segment = new intersectSegment(point0, point),
              intersections = [];
          for (i = 0, j = 100; i < segments.length && j > 0; ++i) {
            s = segments[i];
            intersection = intersect(segment, s);
            if (intersection) {
              if (intersection === intersectCoincident ||
                  cartesianEqual(intersection, point0) || cartesianEqual(intersection, point) ||
                  cartesianEqual(intersection, s.from) || cartesianEqual(intersection, s.to)) {
                t = 1e-4;
                lambda = (lambda + 3 * pi + randsign(i,j) * t) % (2 * pi) - pi;
                phi = min(pi / 2 - 1e-4, max(1e-4 - pi / 2, phi + randsign(i,j) * t));
                segment = new intersectSegment(point0, point = cartesian([lambda, phi]));
                i = -1, --j;
                intersections.length = 0;
                continue;
              }
              var sph = spherical(intersection);
              intersection.distance = clipPolygonDistance(point0, intersection);
              intersection.index = i;
              intersection.t = clipPolygonDistance(s.from, intersection);
              intersection[0] = sph[0], intersection[1] = sph[1], intersection.pop();
              intersections.push(intersection);
            }
          }
          if (intersections.length) {
            clean = 0;
            intersections.sort(function(a, b) { return a.distance - b.distance; });
            for (i = 0; i < intersections.length; ++i) {
              intersection = intersections[i];
              v = !v;
              if (v) {
                stream.lineStart();
                stream.point(intersection[0], intersection[1], intersection.index, intersection.t);
              } else {
                stream.point(intersection[0], intersection[1], intersection.index, intersection.t);
                stream.lineEnd();
              }
            }
          }
          if (v) stream.point(lambda, phi);
        } else {
          for (i = 0, j = 100; i < segments.length && j > 0; ++i) {
            s = segments[i];
            if (intersectPointOnLine(point, s)) {
              t = 1e-4;
              lambda = (lambda + 3 * pi + randsign(i,j) * t) % (2 * pi) - pi;
              phi = min(pi / 2 - 1e-4, max(1e-4 - pi / 2, phi + randsign(i,j) * t));
              point = cartesian([lambda, phi]);
              i = -1, --j;
            }
          }
          v00 = v = visible(lambda00 = lambda, phi00 = phi);
          if (v) stream.lineStart(), stream.point(lambda, phi);
        }
        point0 = point, v0 = v;
      },
      lineEnd: function() {
        if (v0) stream.lineEnd();
      },
      // Rejoin first and last segments if there were intersections and the first
      // and last points were visible.
      clean: function() {
        return clean | ((v00 && v0) << 1);
      }
    };
  }

  function interpolate(from, to, direction, stream) {
    if (from == null) {
      var n = polygon.length;
      polygon.forEach(function(ring, i) {
        ring.forEach(function(point) { stream.point(point[0], point[1]); });
        if (i < n - 1) stream.lineEnd(), stream.lineStart();
      });
    } else if (from.index !== to.index && from.index != null && to.index != null) {
      for (var i = from.index; i !== to.index; i = (i + direction + segments.length) % segments.length) {
        var segment = segments[i],
            point = spherical(direction > 0 ? segment.to : segment.from);
        stream.point(point[0], point[1]);
      }
    }
  }

  var c = clip(visible, clipLine, interpolate, polygon[0][0], clipPolygonSort);
  
  c.polygon = function() {
    return {
      type: "Polygon",
      coordinates: polygon.map(function(e) {
        return e.map(function(d) {
          return [ d[0] * degrees, d[1] * degrees];
        });
      })
    };
  };
  
  return c;
}

function clipPolygonSort(a, b) {
  a = a.x, b = b.x;
  return a.index - b.index || a.t - b.t;
}

// Geodesic coordinates for two 3D points.
function clipPolygonDistance(a, b) {
  var axb = cartesianCross(a, b);
  return atan2(sqrt(cartesianDot(axb, axb)), cartesianDot(a, b));
}