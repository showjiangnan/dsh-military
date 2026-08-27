---- MODULE MilitaryCore ----
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS Tasks, Agents, Guidance
VARIABLES taskState, taskVersion, frozen, writeActive, acceptedCandidate, guidanceVersion

TaskStates == {"READY", "EXECUTING", "VERIFYING", "ACCEPTED", "REWORK", "FROZEN"}

Init == /\ taskState = [t \in Tasks |-> "READY"]
        /\ taskVersion = [t \in Tasks |-> 1]
        /\ frozen = {}
        /\ writeActive = {}
        /\ acceptedCandidate = [t \in Tasks |-> 0]
        /\ guidanceVersion = [g \in Guidance |-> 0]

Start(t, a) == /\ taskState[t] = "READY"
               /\ a \notin frozen
               /\ taskState' = [taskState EXCEPT ![t] = "EXECUTING"]
               /\ UNCHANGED <<taskVersion, frozen, writeActive, acceptedCandidate, guidanceVersion>>

Freeze(a) == /\ frozen' = frozen \cup {a}
             /\ writeActive' = writeActive \ {a}
             /\ UNCHANGED <<taskState, taskVersion, acceptedCandidate, guidanceVersion>>

Accept(t, c) == /\ taskState[t] = "VERIFYING"
                /\ acceptedCandidate[t] = 0
                /\ taskState' = [taskState EXCEPT ![t] = "ACCEPTED"]
                /\ acceptedCandidate' = [acceptedCandidate EXCEPT ![t] = c]
                /\ UNCHANGED <<taskVersion, frozen, writeActive, guidanceVersion>>

Rework(t) == /\ taskState[t] \in {"VERIFYING", "REWORK"}
             /\ taskVersion' = [taskVersion EXCEPT ![t] = @ + 1]
             /\ taskState' = [taskState EXCEPT ![t] = "READY"]
             /\ UNCHANGED <<frozen, writeActive, acceptedCandidate, guidanceVersion>>

DeliverGuidance(g, t) == /\ guidanceVersion[g] = taskVersion[t]
                         /\ UNCHANGED <<taskState, taskVersion, frozen, writeActive, acceptedCandidate, guidanceVersion>>

Next == (\E t \in Tasks, a \in Agents: Start(t, a))
     \/ (\E a \in Agents: Freeze(a))
     \/ (\E t \in Tasks, c \in Nat: Accept(t, c))
     \/ (\E t \in Tasks: Rework(t))
     \/ (\E g \in Guidance, t \in Tasks: DeliverGuidance(g, t))

FrozenNoWrite == \A a \in frozen: a \notin writeActive
AcceptedTerminal == \A t \in Tasks: taskState[t] = "ACCEPTED" => acceptedCandidate[t] # 0
OneAccepted == \A t \in Tasks: acceptedCandidate[t] >= 0
TypeOK == /\ taskState \in [Tasks -> TaskStates]
          /\ taskVersion \in [Tasks -> Nat]
          /\ frozen \subseteq Agents
          /\ writeActive \subseteq Agents

Spec == Init /\ [][Next]_<<taskState, taskVersion, frozen, writeActive, acceptedCandidate, guidanceVersion>>

====
