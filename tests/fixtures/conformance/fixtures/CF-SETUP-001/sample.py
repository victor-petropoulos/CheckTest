import pytest

@pytest.fixture(autouse=True)
def setup():
    assert 1 == 1

def test_body_has_no_assertion():
    value = 1
