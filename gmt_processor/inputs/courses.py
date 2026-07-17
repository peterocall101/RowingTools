#!/usr/bin/env python3
"""
courses.py - shared regatta course registry for the "race conditions" feature.

Each course has the coordinates and the start->finish bearing (compass heading
the boats travel, 0=N, 90=E), measured in Google Earth. The bearing is what
drives the head / tail / cross-wind verdict, so it must be the racing direction.

COMP_VENUE maps each competition code (the --comp value / heatmap-<comp>.html)
to its course key. Everything is at Dorney Lake except British Rowing Champs and
Nottingham City (Holme Pierrepont), Poplar (Royal Albert Dock) and Reading
Amateur (River Thames, Reading).
"""

COURSES = {
    # key        name                              lat        lon       bearing  lanes
    "dorney":  {"name": "Dorney Lake, Eton",            "lat": 51.5002798, "lon": -0.6770478, "bearing": 127, "lanes": 8},
    "reading": {"name": "River Thames, Reading",        "lat": 51.4665115, "lon": -0.9792236, "bearing": 107, "lanes": 2},
    "holme":   {"name": "Holme Pierrepont, Nottingham", "lat": 52.9537279, "lon": -1.0710370, "bearing": 228, "lanes": 6},
    "albert":  {"name": "Royal Albert Dock, London",    "lat": 51.5077397, "lon":  0.0410846, "bearing": 273, "lanes": 6},
}

COMP_VENUE = {
    "marlow25": "dorney", "marlow26": "dorney",
    "metsat25": "dorney", "metsun25": "dorney",
    "metsat26": "dorney", "metsun26": "dorney",
    "nsr26": "dorney", "bucs26": "dorney",
    "wallingford25": "dorney", "wallingford26": "dorney",
    "reading26": "reading",
    "poplar26": "albert",
    "nottm25": "holme", "nottm26": "holme", "brcc25": "holme", "brcc26": "holme",
}


def venue_for(comp):
    """Return the course config dict for a competition code, or None if unknown."""
    key = COMP_VENUE.get(comp)
    return COURSES.get(key) if key else None
