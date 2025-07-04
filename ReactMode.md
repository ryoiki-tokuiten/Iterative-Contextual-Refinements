Add a new application mode called "React", this will be for making applications in react js.

### Architecture:

User will enter an app request = {user_request}, we will take this request and send to the **Orchestrator Agent** LLM.
- The Orchestrator Agent will generate a JSON based on the {user_request}. This JSON will contain plan.txt and set of system instructions and prompts for each agent (LLM) in the next stages.
- There are no pipelines. Single pipelines. 5 tabs each showing the stage specific information, context, input, output and everything.
- There will be 5 stages and all will be processed in parallel. we will take the output from each stage (which will be bunch of code files) and append it to the final file, which the user can download and test manually. 
- Just like other modes, user can edit the system instructions of the Orchestrator Agent.

## Thet role of orchestrator agent:
Transform the {user_request} into plan.txt and sets of system instructions and prompts for 5 different LLMs. There are no fixed system instructions and prompts, it is dynamic for each stage and are generated each time based on the user_request. 
Orchestrator agent will divide the task (which is making an application in react) to 5 different LLMs. The novel idea here is: the task assigned to each LLM will be different, self-contained, independent, specific and focused. Our system (which you will code) will take the final output from each LLM (which will be bunch of code files) and then append it to one final file which contains **ALL** the application code files which the user can download and test manually.
- Plan.txt will be a 5 stage plan and will be designed in such a way that the next stage 5 agents get the full **Context** about the other files, how things are defined in them.  
The plan.txt will be very very long, highly detailed, concise, highly technical and information-dense. It will be a complete plan for making this application. Now, crucially, how this plan.txt is written is very important because this plan.txt is not being done by one agent, but by multiple independent agents. This plan.txt will be 5 stages plan and it is to keep the LLMs in next stage (the 5 agents) updated with what is being processed and implemented in parallel.
- The system instructions of **Agent 2** should contain the tasks that have been assigned to the **Agent 1**, **Agent 3**, **Agent 4** and **Agent 5** in parallel, we must tell it that these tasks (with a complete description) are being processed in parallel and **your** output file will be then appended to their files.. Similarly Agent 3 will know about the tasks assigned to the **Agent 1, 2, 4 and 5** and so on. The Orchestrator will generate system instructions for each agent in such a way that they act as a Full task description and instruction to what things to do and *also* as a shared memory of what's being added to the application in parallel.
- The Plan.txt would be actually full description of how this application will be developed, what things will be defined where. what tasks will be assigned to which agent. what will be defined in what file etc The orchestrator agent must develop plan.txt so that the **Agent 1** gets for example main html and css file to design., the **Agent 2** gets for example the main logic files to design., the **Agent 3** gets for example the components to design and so on...  It's not fixed like Agent 1 must get html and css file, the orchestrator must decide that intelligently. The orchestrator agent will also define the path of the file etc. And we just take all of these files,  append them and make one file with complete application code and then  allow the user to download that or copy and test manually. The **Agent 1** should know for example that it is called **Agent 1**. Because our plan.txt contains the full description of how this application is being developed and what task each agent is assigned to. Plan.txt must include text like **Agent 1** will be doing this, **Agent 2** will be doing this....
- Ofc, the orchestrator must design the system instructions with 2 things in mind: telling the agent exactly what to write in the specific assigned file, and ask it provide complete updated full files, and a shared memory of what's being processed in parallel.
For example, **Agent 1** is assigned to write a new **geminiService.ts** file with this specific goal, {here is the full description of the task}, and {here is the full description of task that is being processed in parallel by Agent 2}, {Here is the full description of task that is being processed in parallel by agent 3} etc. We must tell each agent to do ONLY IT'S TASK. 
- The orchestrator needs to be extremely sophisticated to create a plan detailed enough that 5 agents can work independently yet produce compatible code
- Each agent's system instructions become very complex (task + shared memory of all other tasks) and it's okay. the more context you give, the better they will perform
- Also support dependency mapping system so agents know exactly what they can expect from other agents
- Enforce consistent coding patterns across all agents (naming conventions, folder structure, component patterns)
- Add linting rules to the orchestrator's plan so all agents follow the same style guide
- Include performance considerations in each agent's instructions (lazy loading, memoization, bundle size)
- Specify exact library versions and dependency management to prevent version conflicts

## Inter-Agent Communication

- Add interface contracts - Agent 1 must define exact prop types/API shapes that Agent 3 will consume
- Create a shared types definition that all agents reference for consistency
- Include data flow diagrams in the plan showing how components will communicate
- Add state management strategy (Redux, Context, etc.) with clear ownership rules

## Error Prevention

- Duplicate detection - prevent agents from creating similar components/functions
- Circular dependency checks - ensure Agent A doesn't depend on Agent B while Agent B depends on Agent A
- Resource conflict prevention - prevent multiple agents from trying to handle the same feature
-

<IMPORTANT> The orchestrator agent must be aware of this environment, architecture, it's role, all the future stages and how they will be appended and stuff like that. It must be aware of what it's plan, instructions and prompts will be producing at each stage and what will be the final output after appending all of them. So, it must **always** proceed intelligently no matter the request.
- The orchestrator agent must suggest a plan that will be produce a high-quality, stable, production-quality application directly. The application produced from this should not be just a basic application or proto-type, but actually useful, usable, professional application. (Non-documented, Yes, don't include docs and testing in the plan. User will manually do that.)
- Instead of writing 1000s of lines of code from scratch, enforce using libraries and re-usable components. Code must be clean and minimal and again LITERALLY PRODUCTION QUALITY CODE (without tests). 
</IMPORTANT>