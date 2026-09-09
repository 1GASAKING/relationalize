import os

from setuptools import setup


def read(fname):
    return open(os.path.join(os.path.dirname(__file__), fname)).read()


setup(
    name="relationalize",
    author="Henry Jones",
    author_email="henry.jones@tulip.co",
    url="https://github.com/tulip/relationalize",
    description="A utility for converting/transporting arbitrary JSON data into a relational database",
    packages=[
        "relationalize",
        "rtdb_bridge",
        "rtdb_bridge.schemas",
    ],
    package_dir={
        "relationalize": "relationalize",
        "rtdb_bridge": "rtdb_bridge",
        "rtdb_bridge.schemas": "rtdb_bridge/schemas",
    },
    package_data={
        "relationalize": ["py.typed"],
        "rtdb_bridge.schemas": ["*.json"],
    },
    extras_require={
        "contracts": ["jsonschema>=3.2.0"],
    },
    include_package_data=True,
    long_description=read("README.md"),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Topic :: Utilities",
    ],
)
