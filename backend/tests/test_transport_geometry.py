import pytest
from pydantic import ValidationError

from app.agent_schemas import LegOut
from app.schemas import MapStop, RouteGeometry


@pytest.mark.parametrize("mode", ["bus", "tram"])
def test_agent_leg_contract_preserves_transport_geometry(mode):
    shape = {"type": "LineString", "coordinates": [[-1.48, 53.38], [-1.47, 53.39]]}
    stops = [{"name": "Example stop", "coordinate": [-1.48, 53.38]}]
    leg = LegOut(mode=mode, instruction="Board the service", minutes=10,
                 line="Example", geometry=shape, map_stops=stops)
    assert leg.model_dump(mode="json")["geometry"] == shape
    assert leg.model_dump(mode="json")["map_stops"] == stops


def test_invalid_route_and_stop_coordinates_are_rejected():
    with pytest.raises(ValidationError):
        RouteGeometry(type="LineString", coordinates=[[999, 53], [-1, 53]])
    with pytest.raises(ValidationError):
        MapStop(name="Invalid", coordinate=[-1, float("nan")])
