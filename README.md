# CCA Project

## 💡 Project Idea: Network Routing Simulation

## 👥 Group Members

| Name | Roll No. |
| :--- | :--- |
| Aryan Ahmed | CT-176 |
| Taha Ahmed | CT-183 |
| Muhammad Sami Aslam | CT-185 |

## Description
<!-- 
This **Hospital Management System** is a lightweight, high-performance console application written in C++ that models real-world clinical workflows. Built with clean Object-Oriented Programming (OOP) principles, it provides tailored terminal interfaces for both **Doctors** and **Patients** without relying on external database engines.

### Key Functional Features

* **Dual-Role Dashboards:** Separate execution tracks for Doctors and Patients featuring an interactive, arrow-key-driven menu navigation system with ANSI color coding.
* **Patient Lifecycle:** Patients can sign up/login, manage profiles, search a directory of registered doctors, view historical medical charts, and dynamically book appointments across a rolling 7-day schedule.
* **Doctor Operations:** Doctors can manage their daily schedule, adjust slot availability caps per weekday on the fly, and pull up today's patient queue to write real-time diagnoses, symptoms, and prescriptions.
* **Custom File-Based Persistence Engine:** Implements a text-file flat-database architecture under `./records/` using raw `std::fstream` operations. Data is compartmentalized using unique 6-digit zero-padded Medical Record (MR#) and Doctor IDs.

### Architectural Breakdown

* **Polymorphic Core (`Person`):** Utilizes an abstract base class `Person` featuring pure virtual functions (`displayProfile` and `dashboard`) to enforce interface consistency across the derived classes `Doctor` and `Patient`.
* **Multiple Inheritance:** The concrete entities inherit from both `Person` (behavioral) and `FileManage` (data accesslayer), encapsulating data processing mechanics locally within each context.
* **Generic UI Templates (`Menu`):** Leverages C++ templates to generate context-fluid inline menus (`Menu::mini`), capable of rendering and validating generic vector types like primitive chars (`M`/`F`) or strings smoothly.
* **Hardware-Fluid Terminal Engine (`Utils`):** Features cross-platform preprocessor directives (`#ifdef _WIN32`) to override low-level I/O behavior. It overrides canonical console input (`tcgetattr`/`_getch`) to sniff raw keyboard arrow registers (`UP`, `DN`, `ENT`), controls echo states for stealth password input, and hooks Windows virtual terminal sequences for native UNIX ANSI escape code rendering.
* **Low-Level Serialization:** Custom state-parsing using `std::stringstream` delimited by custom bounds (`|` pipelines) and geometric structural delimiters (`│`) inside flat text files to manage multi-tiered schedule configurations.
-->